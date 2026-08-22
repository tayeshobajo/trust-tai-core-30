/**
 * Low-level provider transport (server only).
 *
 * This module is plumbing, not a reasoning entry point. It knows three things:
 * how to verify membership fail-closed, how to reach the configured
 * intelligence provider and stream a reply, and how to extract the json
 * object from a model's text. It decides nothing about what a room asks or
 * how the answer is judged.
 *
 * Rooms never import this module. Every business room reasons through the
 * runtime boundary (src/lib/intelligence-runtime.server.ts), which verifies
 * access and then calls this transport. The fragmentation guard
 * (src/lib/intelligence-runtime-boundary.test.ts) enforces that. Offline QA
 * harnesses under scripts/ may import it directly to build a model caller —
 * they are operator-run tooling, not app code.
 *
 * Provider discipline: keys never leave the server, the provider that
 * answered is recorded truthfully, and with no provider configured the call
 * fails closed rather than inventing an answer.
 */

import {
  trustTaiSupabaseKey,
  trustTaiSupabaseUrl,
} from "@/lib/trust-tai-backend.server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  createLovableAiGatewayRunIdFetch,
  LOVABLE_AIG_RUN_ID_HEADER,
} from "./ai-gateway.server";
import { selectScoutProvider } from "./scout-provider.server";

function supabaseUrl(): string {
  return trustTaiSupabaseUrl();
}

function supabaseKey(): string {
  return trustTaiSupabaseKey();
}

/** A client acting as the signed-in person. RLS applies to every call. */
function clientFor(token: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey() } },
  });
}

/** Membership is verified server-side; a token alone is never enough. */
async function requireMembership(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .limit(1);
  return !error && (data ?? []).length > 0;
}

/**
 * Fail closed for any reasoning pass: a valid Trust Tai token and an active
 * membership in this organization, both checked against the real backend.
 */
export async function requireRoadmapAccess(
  token: string,
  organizationId: string,
): Promise<boolean> {
  return requireMembership(clientFor(token), organizationId);
}

/* --------------------------------------------------------------- provider */

export interface ProviderCallOptions {
  webSearch: boolean;
  /**
   * An explicit strict response format (e.g. Scout's candidate schema). When
   * present it is sent verbatim; the caller takes responsibility for pairing
   * it correctly with webSearch.
   */
  responseFormat?: Record<string, unknown> | undefined;
  /** Fires on every streamed text delta, so callers can report mid-run progress. */
  onDelta?: ((delta: string) => void) | undefined;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
  initialRunId?: string | undefined;
}

export async function callRoadmapProvider(
  instructions: string,
  input: string,
  options: ProviderCallOptions,
): Promise<{ raw: string; provider: string; model: string }> {
  const selected = selectScoutProvider();
  if (!selected) {
    throw new Error(
      "No intelligence provider is configured, so the runtime cannot reason. Nothing was changed.",
    );
  }

  const doFetch = options.gateway?.fetch ?? fetch;
  const response = await doFetch(selected.endpoint, {
    method: "POST",
    headers: {
      ...selected.headers,
      ...(selected.provider === "lovable" && options.initialRunId
        ? { [LOVABLE_AIG_RUN_ID_HEADER]: options.initialRunId }
        : {}),
    },
    body: JSON.stringify({
      model: selected.model,
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "medium", summary: "auto" },
      // Web search and the json response format are mutually exclusive
      // upstream for generic calls, so a research pass asks for json in the
      // prompt and the reply is unwrapped by extractJsonObject. A caller that
      // passes an explicit strict responseFormat (e.g. Scout's candidate
      // schema) opts into sending both, which the hosted tool supports.
      ...(options.webSearch ? { tools: [{ type: "web_search" }] } : {}),
      ...(options.responseFormat
        ? { text: { format: options.responseFormat } }
        : options.webSearch
          ? {}
          : { text: { format: { type: "json_object" } } }),
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(
      `The reasoning provider refused the request (${response.status}). ${detail.slice(0, 240)}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = String(event["type"] ?? "");
      if (type === "response.output_text.delta" && typeof event["delta"] === "string") {
        const delta = event["delta"];
        raw += delta;
        options.onDelta?.(delta);
      }
      if (type === "response.failed" || type === "error") {
        throw new Error("The reasoning run failed before returning anything.");
      }
    }
  }

  return { raw, provider: selected.provider, model: selected.model };
}

/* --------------------------------------------------------------- parsing */

/**
 * The json object in a model reply.
 *
 * A web search run cannot be pinned to json response format, so the text can
 * arrive wrapped in a code fence or trailed by a citation line. This reads the
 * outermost balanced object rather than trusting the whole string.
 */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // fall through to a balanced scan
  }
  const start = text.indexOf("{");
  if (start < 0) throw new Error("The provider returned no json object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
      }
    }
  }
  throw new Error("The provider returned no complete json object.");
}
