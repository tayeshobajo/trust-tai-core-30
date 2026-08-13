/**
 * Trust Tai OS — Scout discovery intelligence boundary (server only).
 *
 * Real market sourcing. Given a plain-English target ("IT companies in
 * Nashville") this module:
 *   1. verifies the caller's Trust Tai Supabase JWT,
 *   2. resolves their organization membership SERVER-SIDE (never trusted from
 *      the client),
 *   3. loads the organization's active ICP as the governing rubric,
 *   4. loads a small set of recent human decisions as calibration examples,
 *   5. asks the Lovable AI Gateway OpenAI Responses API — with the hosted
 *      `web_search` tool and a strict JSON schema — for real, currently
 *      evidenced companies,
 *   6. validates and de-duplicates by normalized root domain,
 *   7. upserts `prospects` (source `scout_ai_discovery`), writes one
 *      `prospect_evaluations` row per company, finalizes the
 *      `scout_discovery_runs` row, and records activity events.
 *
 * Fail closed: with no `LOVABLE_API_KEY` nothing is discovered and the caller is
 * told plainly. There is no fallback to demo data, ever.
 *
 * Every database write is made with the CALLER'S token, so Supabase RLS and the
 * organization boundary still apply. No service-role key is used here.
 */


import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  DISCOVERY_SOURCE,
  SCOUT_DISCOVERY_EVALUATOR_VERSION,
  acceptCandidates,
  discoveryEvaluation,
  rootDomain,
  type RawDiscoveryCandidate,
} from "@/data/scout-candidate-validation";
import {
  createLovableAiGatewayRunIdFetch,
  LOVABLE_AIG_RUN_ID_HEADER,
} from "@/lib/ai-gateway.server";
import { buildDiscoveryRequestBody } from "@/lib/scout-discovery-request";
import { selectScoutProvider } from "@/lib/scout-provider.server";

const DEFAULT_LIMIT = 25;

const MAX_LIMIT = 50;
/** Seconds an organization must wait between discovery runs. */
export const RUN_COOLDOWN_SECONDS = 45;

export interface DiscoverStage {
  stage: "reading_icp" | "searching" | "verifying" | "evaluating" | "shortlist" | "done" | "error";
  message: string;
  data?: Record<string, unknown>;
}

/** The model of the provider Scout would actually use right now. */
export function discoveryModel(): string | null {
  return selectScoutProvider()?.model ?? null;
}

export function discoveryConfigured(): boolean {
  return Boolean(selectScoutProvider());
}



function supabaseUrl(): string {
  return (
    process.env["TRUST_TAI_SUPABASE_URL"] ||
    process.env["VITE_SUPABASE_URL"] ||
    "https://okydosoacqdnursmmenf.supabase.co"
  );
}

function supabaseKey(): string {
  return (
    process.env["TRUST_TAI_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL"
  );
}

/** A Supabase client acting as the signed-in user. RLS applies to every call. */
function clientFor(token: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey() },
    },
  });
}

const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "company_name",
          "website",
          "location",
          "industry",
          "summary",
          "discovery_reason",
          "observed_evidence",
          "source_urls",
          "unknowns",
          "icp_fit",
        ],
        properties: {
          company_name: { type: "string" },
          website: { type: "string" },
          location: { type: ["string", "null"] },
          industry: { type: ["string", "null"] },
          summary: { type: "string" },
          discovery_reason: { type: "string" },
          observed_evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["statement", "source_url"],
              properties: {
                statement: { type: "string" },
                source_url: { type: ["string", "null"] },
              },
            },
          },
          source_urls: { type: "array", items: { type: "string" } },
          unknowns: { type: "array", items: { type: "string" } },
          icp_fit: {
            type: "object",
            additionalProperties: false,
            required: ["light", "score", "confidence", "reasoning", "criteria"],
            properties: {
              light: { type: "string", enum: ["green", "yellow", "red"] },
              score: { type: "integer" },
              confidence: { type: "string", enum: ["high", "moderate", "low", "unknown"] },
              reasoning: { type: "string" },
              criteria: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "name",
                    "weight",
                    "status",
                    "score_contribution",
                    "evidence",
                    "source_urls",
                    "confidence",
                  ],
                  properties: {
                    name: { type: "string" },
                    weight: { type: "number" },
                    status: {
                      type: "string",
                      enum: ["met", "partial", "unknown", "missed", "disqualifier"],
                    },
                    score_contribution: { type: "number" },
                    evidence: { type: "string" },
                    source_urls: { type: "array", items: { type: "string" } },
                    confidence: { type: "string", enum: ["high", "moderate", "low", "unknown"] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

function instructions(icp: string, calibration: string, limit: number): string {
  return [
    "You are Trust Tai Scout, a conservative B2B sourcing analyst.",
    "",
    "GOVERNING RUBRIC — the Ideal Client Profile below is the source of truth.",
    "Judge every company against it. Never substitute your own idea of a good client.",
    "",
    "=== ACTIVE ICP ===",
    icp || "No ICP has been saved. Score every company yellow with low confidence.",
    "=== END ICP ===",
    "",
    calibration,
    "",
    "RULES",
    `1. Use web_search. Return only REAL companies with current public web evidence. Aim for ${limit}.`,
    "2. Never fabricate a company, person, email, LinkedIn profile, revenue, headcount, budget or technology stack.",
    "3. Every company needs a real website URL you saw plus at least one source URL.",
    "4. Anything you could not establish goes in `unknowns`. Unknown is NOT negative — never score it as a mismatch.",
    "5. Traffic lights describe ICP FIT only: green = strong fit with sufficient evidence; yellow = plausible, mixed or thin evidence needing human review; red = material mismatch with the ICP.",
    "6. A hard disqualifier stated in the ICP sets that criterion to `disqualifier` and forces red.",
    "7. Thin public evidence lowers confidence and can never be green.",
    "8. Give a concise reasoning summary of the conclusion and its evidence. Do not output step-by-step deliberation.",
    "9. Do not judge how reachable a decision maker is; reachability is assessed separately from fit.",
  ].join("\n");
}

export interface DiscoverInput {
  token: string;
  query: string;
  limit?: number;
  organizationId?: string;
  initialRunId?: string;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch>;
}



/**
 * Run a discovery pass, yielding progress stages as they happen so the board can
 * show what Scout is actually doing rather than a spinner.
 */
export async function* runDiscovery(input: DiscoverInput): AsyncGenerator<DiscoverStage> {
  const lovableApiKey = process.env["LOVABLE_API_KEY"];
  if (!lovableApiKey) {
    yield {
      stage: "error",
      message:
        "Scout intelligence is not connected. Add LOVABLE_API_KEY in project secrets to enable live market discovery.",
      data: { configured: false },
    };
    return;
  }

  const model = discoveryModel();
  const gateway = input.gateway ?? createLovableAiGatewayRunIdFetch(input.initialRunId);

  const supabase = clientFor(input.token);


  const { data: userData, error: userError } = await supabase.auth.getUser(input.token);
  const user = userData?.user;
  if (userError || !user) {
    yield { stage: "error", message: "Your session is not valid. Sign in again." };
    return;
  }

  const { data: memberships } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, status")
    .eq("user_id", user.id);
  const active = (memberships ?? []).filter((m) => (m["status"] ?? "active") === "active");
  const membership = input.organizationId
    ? active.find((m) => m["organization_id"] === input.organizationId)
    : active[0];
  if (!membership) {
    yield { stage: "error", message: "Your account is not a member of a Trust Tai workspace." };
    return;
  }
  const orgId = membership["organization_id"] as string;

  const query = input.query.trim();
  if (query.length < 3) {
    yield { stage: "error", message: "Describe who you are looking for." };
    return;
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));

  yield { stage: "reading_icp", message: "Reading ICP" };

  const { data: icpRows } = await supabase
    .from("icp_profiles")
    .select("*")
    .eq("organization_id", orgId)
    .order("version", { ascending: false })
    .limit(1);
  const icp = (icpRows ?? [])[0] ?? null;
  const icpVersion = icp ? Number(icp["version"] ?? 1) : null;

  // Rate limit: repeated clicks cannot create runaway provider spend.
  const since = new Date(Date.now() - RUN_COOLDOWN_SECONDS * 1000).toISOString();
  const { data: recent } = await supabase
    .from("scout_discovery_runs")
    .select("id, status, created_at, query")
    .eq("organization_id", orgId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = (recent ?? [])[0];
  if (last && (last["status"] === "running" || last["query"] === query)) {
    yield {
      stage: "error",
      message:
        last["status"] === "running"
          ? "A discovery run is already in progress. Give it a moment."
          : "That exact search just ran. Open the run in Research, or change the query.",
      data: { run_id: last["id"] },
    };
    return;
  }

  // Calibration examples. Feedback sharpens interpretation; it never rewrites
  // the ICP, which stays the source of truth.
  const { data: feedbackRows } = await supabase
    .from("scout_feedback")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(12);
  const calibration = (feedbackRows ?? []).length
    ? [
        "CALIBRATION — recent Trust Tai decisions. They sharpen how the ICP is read.",
        "They never override or replace the ICP.",
        ...(feedbackRows ?? []).map((row) => {
          const meta = (row["metadata"] ?? {}) as Record<string, unknown>;
          return `- ${meta["company_name"] ?? "A company"} (${meta["domain"] ?? "domain unknown"}): Trust Tai chose "${row["decision"]}"${row["human_fit"] ? `, fit ${row["human_fit"]}` : ""}${row["reason"] ? ` — ${row["reason"]}` : ""}.`;
        }),
      ].join("\n")
    : "";

  const startedAt = new Date().toISOString();
  const { data: runRow } = await supabase
    .from("scout_discovery_runs")
    .insert({
      organization_id: orgId,
      query,
      status: "running",
      provider: "lovable",
      model,
      icp_version: icpVersion,
      requested_count: limit,
      created_by: user.id,
    })
    .select("*")
    .maybeSingle();
  const runId = (runRow?.["id"] as string | undefined) ?? null;

  const failRun = async (message: string) => {
    if (runId) {
      await supabase
        .from("scout_discovery_runs")
        .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
        .eq("id", runId);
    }
  };

  yield { stage: "searching", message: "Searching market", data: { run_id: runId } };

  // Streamed so a multi-minute research run never dies on a request timeout.
  let raw = "";
  try {
    const response = await gateway.fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableApiKey,
        "X-Lovable-AIG-SDK": "fetch",
        ...(input.initialRunId ? { [LOVABLE_AIG_RUN_ID_HEADER]: input.initialRunId } : {}),
      },
      body: JSON.stringify({
        model,
        stream: true,
        instructions: instructions(String(icp?.["content_markdown"] ?? ""), calibration, limit),
        input: `Find up to ${limit} real companies matching: ${query}`,
        tools: [{ type: "web_search" }],
        text: {
          format: { type: "json_schema", name: "scout_candidates", strict: true, schema: CANDIDATE_SCHEMA },
        },
      }),
    });


    if (!response.ok || !response.body) {
      const detail = await response.text();
      await failRun(`Provider rejected the request (${response.status}).`);
      yield { stage: "error", message: `Scout's research provider refused the request (${response.status}). ${detail.slice(0, 300)}` };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let searched = false;
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
          if (!searched) {
            searched = true;
            yield { stage: "verifying", message: "Verifying companies" };
          }
          raw += event["delta"];
        }
        if (type === "response.failed" || type === "error") {
          await failRun("The research run failed.");
          yield { stage: "error", message: "The research run failed before returning companies." };
          return;
        }
      }
    }
  } catch (error) {
    await failRun(String(error));
    yield { stage: "error", message: "Scout could not reach the research provider. Nothing was changed." };
    return;
  }

  let candidates: RawDiscoveryCandidate[] = [];
  try {
    const parsed = JSON.parse(raw) as { candidates?: unknown };
    candidates = Array.isArray(parsed.candidates) ? (parsed.candidates as RawDiscoveryCandidate[]) : [];
  } catch {
    await failRun("The research result could not be read.");
    yield { stage: "error", message: "Scout could not read the research result. Nothing was changed." };
    return;
  }

  yield { stage: "evaluating", message: "Evaluating fit", data: { returned: candidates.length } };

  const { accepted, rejected } = acceptCandidates(candidates);

  const { data: existingRows } = await supabase
    .from("prospects")
    .select("id, website_url, company_name, status, metadata")
    .eq("organization_id", orgId);
  const byDomain = new Map<string, Record<string, unknown>>();
  for (const row of existingRows ?? []) {
    const key = rootDomain(row["website_url"]);
    if (key) byDomain.set(key, row as Record<string, unknown>);
  }

  const finishedAt = new Date().toISOString();
  let savedCount = 0;

  for (const { domain, candidate } of accepted) {
    const fit = candidate.icp_fit ?? {};
    const score = Math.max(0, Math.min(100, Number(fit.score ?? 0)));
    const observed = Array.isArray(candidate.observed_evidence) ? candidate.observed_evidence : [];
    const provenance = {
      app_id: "scout",
      source: DISCOVERY_SOURCE,
      provider: "lovable",
      model,
      evaluator_version: SCOUT_DISCOVERY_EVALUATOR_VERSION,
      icp_version: icpVersion,
      discovery_run_id: runId,
      query,
      citations: candidate.source_urls ?? [],
      observed_at: finishedAt,
      actor: { type: "intelligence", id: "scout-discover" },
    };
    const inferred = {
      why_it_fits: candidate.discovery_reason,
      summary: candidate.summary,
      location: candidate.location ?? null,
      industry: candidate.industry ?? null,
      unknowns: candidate.unknowns ?? [],
      confidence: fit.confidence ?? "unknown",
    };
    const fields = {
      company_name: candidate.company_name,
      website_url: `https://${domain}`,
      source: DISCOVERY_SOURCE,
      observed,
      inferred,
      suggested: { recommendation: fit.reasoning ?? "" },
      provenance,
      fit_score: score,
    };

    // Stored in the app's own evaluation shape so a discovered company reads on
    // the board exactly like a researched one.
    const evaluation = discoveryEvaluation(candidate, { icpVersion, at: finishedAt });
    const discoveryMeta = { run_id: runId, query, at: finishedAt, model, citations: candidate.source_urls ?? [] };

    const existing = byDomain.get(domain);
    let prospectId: string | undefined;
    if (existing) {
      const metadata = {
        ...((existing["metadata"] ?? {}) as Record<string, unknown>),
        scout_discovery: discoveryMeta,
        scout_fit: evaluation,
      };
      const { data } = await supabase
        .from("prospects")
        .update({ ...fields, metadata })
        .eq("id", existing["id"] as string)
        .select("id")
        .maybeSingle();
      prospectId = (data?.["id"] as string | undefined) ?? (existing["id"] as string);
    } else {
      const { data } = await supabase
        .from("prospects")
        .insert({
          ...fields,
          organization_id: orgId,
          status: "discovered",
          created_by: user.id,
          metadata: {
            scout_discovery: discoveryMeta,
            scout_fit: evaluation,
          },
        })
        .select("id")
        .maybeSingle();
      prospectId = data?.["id"] as string | undefined;
    }

    if (!prospectId) continue;
    savedCount += 1;

    await supabase.from("prospect_evaluations").insert({
      organization_id: orgId,
      prospect_id: prospectId,
      discovery_run_id: runId,
      evaluator: "scout-discover",
      evaluator_version: SCOUT_DISCOVERY_EVALUATOR_VERSION,
      provider: "lovable",
      model,
      icp_version: icpVersion,
      score,
      fit_light: fit.light ?? "yellow",
      confidence: fit.confidence ?? "unknown",
      criteria: fit.criteria ?? [],
      observed,
      inferred,
      suggested: { recommendation: fit.reasoning ?? "" },
      citations: candidate.source_urls ?? [],
      reasoning_summary: fit.reasoning ?? "",
      created_by: user.id,
    });

    for (const name of ["prospect.discovered", "prospect.evaluated"] as const) {
      await supabase.from("activities").insert({
        organization_id: orgId,
        name,
        subject_type: "prospect",
        subject_id: prospectId,
        summary:
          name === "prospect.discovered"
            ? `${candidate.company_name} was sourced from the public web for "${query}".`
            : `${candidate.company_name} was evaluated against ICP v${icpVersion ?? "—"}: ${score}% (${fit.light ?? "yellow"}).`,
        payload: {
          query,
          run_id: runId,
          model,
          score,
          fit_light: fit.light ?? "yellow",
          citations: candidate.source_urls ?? [],
        },
        provenance,
        occurred_at: finishedAt,
        created_by: user.id,
      });
    }
  }

  if (runId) {
    await supabase
      .from("scout_discovery_runs")
      .update({
        status: "succeeded",
        result_count: savedCount,
        finished_at: finishedAt,
        response_meta: {
          provider: "lovable",
          model,
          returned: candidates.length,
          accepted: accepted.length,
          rejected,
          started_at: startedAt,
        },
      })
      .eq("id", runId);
  }

  yield {
    stage: "shortlist",
    message: "Building shortlist",
    data: { saved: savedCount, rejected, run_id: runId },
  };
  yield {
    stage: "done",
    message: `${savedCount} compan${savedCount === 1 ? "y" : "ies"} added to the board.`,
    data: {
      run_id: runId,
      saved: savedCount,
      rejected,
      returned: candidates.length,
      icp_version: icpVersion,
      model,
    },
  };
}
