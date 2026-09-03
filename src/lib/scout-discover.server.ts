/**
 * Trust Tai OS, Scout discovery intelligence boundary (server only).
 *
 * Real market sourcing. Given a plain-English target ("IT companies in
 * Nashville") this module:
 *   1. verifies the caller's Trust Tai Supabase JWT,
 *   2. resolves their organization membership SERVER-SIDE (never trusted from
 *      the client),
 *   3. loads the organization's active ICP as the governing rubric,
 *   4. loads a small set of recent human decisions as calibration examples,
 *   5. asks the Lovable AI Gateway OpenAI Responses API, with the hosted
 *      `web_search` tool and a strict JSON schema, for real, currently
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

import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  DISCOVERY_SOURCE,
  SCOUT_DISCOVERY_EVALUATOR_VERSION,
  asArray,
  acceptCandidates,
  discoveryEvaluation,
  rootDomain,
  type RawDiscoveryCandidate,
} from "@/data/scout-candidate-validation";
import { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";
import { CANDIDATE_SCHEMA, discoveryInstructions } from "@/lib/scout-discovery-request";
import {
  runtimeModelCaller,
  runtimeProviderStatus,
  type RuntimeModelCaller,
} from "@/lib/intelligence-runtime.server";

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
  return runtimeProviderStatus().model;
}

export function discoveryConfigured(): boolean {
  return runtimeProviderStatus().configured;
}

function supabaseUrl(): string {
  return trustTaiSupabaseUrl();
}

function supabaseKey(): string {
  return trustTaiSupabaseKey();
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
  const status = runtimeProviderStatus();
  if (!status.configured) {
    yield {
      stage: "error",
      message:
        "Scout intelligence is not connected. Add OPENAI_API_KEY (or LOVABLE_API_KEY) in project secrets to enable live market discovery.",
      data: { configured: false },
    };
    return;
  }

  const providerName = status.provider ?? "unknown";
  const model = status.model ?? "unknown";
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

  /* All model contact flows through the runtime boundary, verified fail-closed. */
  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: orgId,
      room: "scout",
      purpose: "discovery",
    });
  } catch {
    yield { stage: "error", message: "Your account is not a member of a Trust Tai workspace." };
    return;
  }

  const query = input.query.trim();
  if (query.length < 3) {
    yield { stage: "error", message: "Describe who you are looking for." };
    return;
  }
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

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
        "CALIBRATION, recent Trust Tai decisions. They sharpen how the ICP is read.",
        "They never override or replace the ICP.",
        ...(feedbackRows ?? []).map((row) => {
          const meta = (row["metadata"] ?? {}) as Record<string, unknown>;
          return `- ${meta["company_name"] ?? "A company"} (${meta["domain"] ?? "domain unknown"}): Trust Tai chose "${row["decision"]}"${row["human_fit"] ? `, fit ${row["human_fit"]}` : ""}${row["reason"] ? ` · ${row["reason"]}` : ""}.`;
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
      provider: providerName,

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

  // Streamed through the runtime boundary so a multi-minute research run
  // never dies on a request timeout. The boundary resolves when the stream
  // completes, so the delta flag is polled to keep the mid-run "verifying"
  // stage honest.
  let raw = "";
  try {
    let sawDelta = false;
    let settled = false;
    const pending = callModel({
      instructions: discoveryInstructions(
        String(icp?.["content_markdown"] ?? ""),
        calibration,
        limit,
      ),
      input: `Find up to ${limit} real companies matching: ${query}`,
      webSearch: true,
      responseFormat: {
        type: "json_schema",
        name: "scout_candidates",
        strict: true,
        schema: CANDIDATE_SCHEMA,
      },
      gateway,
      ...(input.initialRunId ? { initialRunId: input.initialRunId } : {}),
      onDelta: () => {
        sawDelta = true;
      },
    });
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    while (!settled && !sawDelta) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (sawDelta && !settled) {
      yield { stage: "verifying", message: "Verifying companies" };
    }
    const result = await pending;
    raw = result.raw;
  } catch (error) {
    await failRun(String(error));
    yield {
      stage: "error",
      message:
        error instanceof Error
          ? error.message
          : "Scout could not reach the research provider. Nothing was changed.",
    };
    return;
  }

  let candidates: RawDiscoveryCandidate[] = [];
  try {
    const parsed = JSON.parse(raw) as { candidates?: unknown };
    candidates = Array.isArray(parsed.candidates)
      ? (parsed.candidates as RawDiscoveryCandidate[])
      : [];
  } catch {
    await failRun("The research result could not be read.");
    yield {
      stage: "error",
      message: "Scout could not read the research result. Nothing was changed.",
    };
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

  // `prospectId|name` keys already on record, so re-running a query never
  // duplicates a person who was already saved.
  const existingContacts = new Set<string>();
  {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("full_name, metadata")
      .eq("organization_id", orgId);
    for (const row of contactRows ?? []) {
      const meta = ((row["metadata"] ?? {}) as Record<string, unknown>)["people"] as
        Record<string, unknown> | undefined;
      const pid = meta?.["prospect_id"];
      const name = String(row["full_name"] ?? "")
        .trim()
        .toLowerCase();
      if (typeof pid === "string" && name) existingContacts.add(`${pid}|${name}`);
    }
  }

  for (const { domain, candidate } of accepted) {
    const fit = candidate.icp_fit ?? {};
    const score = Math.max(0, Math.min(100, Number(fit.score ?? 0)));
    const observed = Array.isArray(candidate.observed_evidence) ? candidate.observed_evidence : [];
    const provenance = {
      app_id: "scout",
      source: DISCOVERY_SOURCE,
      provider: providerName,
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
    const discoveryMeta = {
      run_id: runId,
      query,
      at: finishedAt,
      model,
      citations: candidate.source_urls ?? [],
    };
    // Buying signals, digital opportunities and named people, kept apart from
    // the fit read: they inform timing, work and reachability, never the score.
    const intelMeta = {
      buying_signals: asArray(candidate.buying_signals),
      opportunities: asArray(candidate.digital_opportunities),
      people: asArray(candidate.people),
      unknowns: candidate.unknowns ?? [],
      citations: candidate.source_urls ?? [],
      collected_at: finishedAt,
      run_id: runId,
    };

    const existing = byDomain.get(domain);
    let prospectId: string | undefined;
    if (existing) {
      const metadata = {
        ...((existing["metadata"] ?? {}) as Record<string, unknown>),
        scout_discovery: discoveryMeta,
        scout_fit: evaluation,
        scout_intel: intelMeta,
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
            scout_intel: intelMeta,
          },
        })
        .select("id")
        .maybeSingle();
      prospectId = data?.["id"] as string | undefined;
    }

    if (!prospectId) continue;
    savedCount += 1;

    // People read from public pages become real contacts, carrying the page
    // they were read from. An email is only stored when it was published:
    // nothing is ever pattern-built, and nothing is marked verified here.
    for (const person of intelMeta.people) {
      const fullName = String(person["full_name"] ?? "").trim();
      if (!fullName) continue;
      const key = `${prospectId}|${fullName.toLowerCase()}`;
      if (existingContacts.has(key)) continue;
      existingContacts.add(key);
      const email = String(person["email"] ?? "").trim();
      await supabase.from("contacts").insert({
        organization_id: orgId,
        full_name: fullName,
        title: String(person["role_title"] ?? "").trim() || null,
        email: email || null,
        created_by: user.id,
        metadata: {
          people: {
            prospect_id: prospectId,
            source_id: "scout_discovery",
            source_url: String(person["source_url"] ?? "").trim() || null,
            linkedin_url: String(person["linkedin_url"] ?? "").trim() || null,
            email_status: email ? "found" : "unknown",
            confidence: "observed",
            decision_maker_likelihood: String(person["decision_maker_likelihood"] ?? "unknown"),
            note: "Read from a public page during market sourcing. The role has not been confirmed by a person.",
            provenance: {
              appId: "scout",
              actor: { type: "intelligence", id: "scout-discover" },
              observedAt: finishedAt,
              sourceKind: "public_website",
            },
          },
        },
      });
    }

    await supabase.from("prospect_evaluations").insert({
      organization_id: orgId,
      prospect_id: prospectId,
      discovery_run_id: runId,
      evaluator: "scout-discover",
      evaluator_version: SCOUT_DISCOVERY_EVALUATOR_VERSION,
      provider: providerName,
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
            : `${candidate.company_name} was evaluated against ICP v${icpVersion ?? "-"}: ${score}% (${fit.light ?? "yellow"}).`,
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
          provider: providerName,
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
