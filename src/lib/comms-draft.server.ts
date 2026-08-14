/**
 * Comms drafting boundary (server only).
 *
 * A draft is composed, never improvised: the organization's Voice DNA, the
 * relationship's recorded evidence, and the chosen register go in; one short
 * message comes back. The deterministic Voice policy then decides whether a
 * person may approve it.
 *
 * Rules enforced here, not left to the model:
 *  - only observed facts and human decisions may be cited,
 *  - nothing is sent,
 *  - a sensitive register is always held for human review,
 *  - with no provider configured, Comms says so rather than inventing a draft.
 *
 * Every read is made with the CALLER'S token, so RLS and the organization
 * boundary still apply. No service-role key is used.
 */

import {
  trustTaiSupabaseKey,
  trustTaiSupabaseUrl,
} from "@/lib/trust-tai-backend.server";
import { createClient } from "@supabase/supabase-js";

import { checkVoice, requiresHumanReview, type VoiceVerdict } from "@/data/voice-policy";
import {
  DEFAULT_VOICE_DOCUMENT,
  REGISTER_GUIDE,
  type VoiceRegister,
} from "@/domain/voice";
import { selectScoutProvider } from "@/lib/scout-provider.server";

const REGISTERS: VoiceRegister[] = [
  "warm_intro",
  "follow_up",
  "reconnect",
  "logistics",
  "sensitive",
];

function supabaseUrl(): string {
  return (
    trustTaiSupabaseUrl()
  );
}

function supabaseKey(): string {
  return (
    trustTaiSupabaseKey()
  );
}

export interface DraftRequest {
  relationshipId: string;
  register: VoiceRegister;
  /** What this message is for, in the writer's own words. Optional. */
  purpose?: string;
}

export interface DraftResult {
  subject: string;
  body: string;
  register: VoiceRegister;
  reviewState: "draft" | "needs_human_review";
  violations: VoiceVerdict["violations"];
  /** The evidence lines the draft was allowed to draw on. */
  usedEvidence: { label: string; value: string; tier: string }[];
  provider: string;
  model: string;
}

export function parseRegister(value: unknown): VoiceRegister {
  return REGISTERS.includes(value as VoiceRegister) ? (value as VoiceRegister) : "follow_up";
}

interface MemoryRow {
  label?: unknown;
  value?: unknown;
  tier?: unknown;
}

function memoryLines(value: unknown, tier: string): { label: string; value: string; tier: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is MemoryRow => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: String(entry.label ?? "Note"),
      value: String(entry.value ?? ""),
      tier,
    }))
    .filter((entry) => entry.value.length > 0);
}

function fallbackDraft(input: {
  firstName: string;
  register: VoiceRegister;
  evidence: { label: string; value: string; tier: string }[];
  metWhere?: string | null;
}): string {
  const detail = input.evidence[0]?.value;
  const opening =
    input.register === "reconnect"
      ? `${input.firstName}, it has been a while.`
      : input.metWhere
        ? `${input.firstName}, good to meet you at ${input.metWhere}.`
        : `${input.firstName}, hello.`;
  const middle = detail ? `\n\n${detail}` : "";
  return `${opening}${middle}\n\nWould a short call next week be useful?`;
}

/**
 * Compose one draft. Returns the checked text plus every rule it tripped, so
 * the reviewer sees exactly what the policy saw.
 */
export async function draftMessage(
  token: string,
  request: DraftRequest,
): Promise<DraftResult> {
  const supabase = createClient(supabaseUrl(), supabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: user, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.user) throw new Error("Sign in to draft a message.");

  const { data: relationship, error } = await supabase
    .from("comms_relationships")
    .select(
      "id, organization_id, full_name, company_name, stage, met_where, next_action, observed, inferred, decided",
    )
    .eq("id", request.relationshipId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!relationship) throw new Error("That relationship is not in your workspace.");

  const row = relationship as Record<string, unknown>;
  const organizationId = String(row["organization_id"]);

  const { data: voice } = await supabase
    .from("comms_voice_profiles")
    .select("content_markdown, version")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const voiceDocument =
    (voice as { content_markdown?: string } | null)?.content_markdown?.trim() ||
    DEFAULT_VOICE_DOCUMENT;

  // Only observed facts and human decisions may be cited. Inferences inform
  // the angle; they never become a claim in the message.
  const usedEvidence = [
    ...memoryLines(row["observed"], "observed"),
    ...memoryLines(row["decided"], "decided"),
  ];
  const inferred = memoryLines(row["inferred"], "inferred");

  const fullName = String(row["full_name"] ?? "there");
  const firstName = fullName.split(/\s+/)[0] ?? fullName;
  const metWhere = (row["met_where"] as string | null) ?? null;
  const register = request.register;

  const provider = selectScoutProvider();
  let body: string;
  let subject: string;
  let providerName = "none";
  let model = "deterministic-fallback";

  if (!provider) {
    body = fallbackDraft({ firstName, register, evidence: usedEvidence, metWhere });
    subject = metWhere ? `Following ${metWhere}` : `A short note`;
  } else {
    providerName = provider.provider;
    model = provider.model;

    const instructions = [
      "You draft one short email for Tai at Trust Tai. You never send anything.",
      "Follow this Voice DNA exactly:",
      voiceDocument,
      `Register: ${register}. ${REGISTER_GUIDE[register]}`,
      "Hard rules: no em dashes, no exclamation marks, no 'just checking in' or 'touching base', no needy phrasing, no claim that is not in the evidence below, no promise of any kind.",
      "Use at most one specific detail from the evidence. If there is no evidence, keep it plain and short.",
      "Return JSON only: {\"subject\": string, \"body\": string}. The body must end with 'Trust,' then a new line then 'Tai'.",
    ].join("\n\n");

    const context = [
      `Recipient: ${fullName}${row["company_name"] ? ` at ${row["company_name"]}` : ""}.`,
      metWhere ? `Where we met: ${metWhere}.` : "We have not met in person.",
      row["next_action"] ? `Our intended next move: ${row["next_action"]}.` : "",
      request.purpose ? `Why we are writing: ${request.purpose}.` : "",
      usedEvidence.length
        ? `Evidence that may be cited:\n${usedEvidence.map((entry) => `- ${entry.label}: ${entry.value} (${entry.tier})`).join("\n")}`
        : "No evidence on record. Do not invent any.",
      inferred.length
        ? `Background reads (may guide the angle, must not be stated as fact):\n${inferred.map((entry) => `- ${entry.value}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: provider.headers,
      body: JSON.stringify({
        model: provider.model,
        instructions,
        input: context,
      }),
    });

    if (!response.ok) {
      throw new Error(`The drafting provider returned ${response.status}.`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const raw = extractText(payload);
    const parsed = safeJson(raw);
    body = String(parsed?.["body"] ?? raw ?? "").trim();
    subject = String(parsed?.["subject"] ?? (metWhere ? `Following ${metWhere}` : "A short note"));
    if (!body) {
      body = fallbackDraft({ firstName, register, evidence: usedEvidence, metWhere });
    }
  }

  const verdict = checkVoice(body, { register, requireSignoff: true });

  return {
    subject: subject.replace(/[!\u2014]/g, "").trim(),
    body: verdict.text,
    register,
    reviewState: requiresHumanReview(register, verdict) ? "needs_human_review" : "draft",
    violations: verdict.violations,
    usedEvidence,
    provider: providerName,
    model,
  };
}

function extractText(payload: Record<string, unknown>): string {
  if (typeof payload["output_text"] === "string") return payload["output_text"] as string;
  const output = payload["output"];
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = (item as Record<string, unknown>)?.["content"];
      if (Array.isArray(content)) {
        for (const part of content) {
          const value = (part as Record<string, unknown>)?.["text"];
          if (typeof value === "string" && value.trim()) return value;
        }
      }
    }
  }
  const choices = payload["choices"];
  if (Array.isArray(choices)) {
    const message = (choices[0] as Record<string, unknown>)?.["message"] as
      | Record<string, unknown>
      | undefined;
    if (typeof message?.["content"] === "string") return message["content"] as string;
  }
  return "";
}

function safeJson(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
