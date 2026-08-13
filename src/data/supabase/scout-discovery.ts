/**
 * Scout — AI market discovery client.
 *
 * The browser never talks to the model provider. It calls Trust Tai's own
 * discovery endpoint with the signed-in user's Supabase token; the server
 * verifies membership, runs the sourcing pass, and writes everything through
 * RLS. This module owns the call, the stage stream, and the read surfaces for
 * runs, evaluations and human feedback.
 *
 * There is no demo fallback. If intelligence is not connected, Scout says so.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { FitLight } from "@/domain/scout-fit";

const ENDPOINT = "/api/public/scout/discover";

export type DiscoveryStageName =
  | "reading_icp"
  | "searching"
  | "verifying"
  | "evaluating"
  | "shortlist"
  | "done"
  | "error";

export interface DiscoveryStage {
  stage: DiscoveryStageName;
  message: string;
  data?: Record<string, unknown>;
}

export interface DiscoveryStatus {
  configured: boolean;
  provider: string;
  model: string | null;
}

export interface DiscoveryRun {
  id: ID;
  query: string;
  status: "running" | "succeeded" | "failed";
  model: string | null;
  icpVersion: number | null;
  requestedCount: number | null;
  resultCount: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  meta: Record<string, unknown>;
}

export interface ProspectEvaluation {
  id: ID;
  prospectId: ID;
  runId: ID | null;
  score: number;
  light: FitLight;
  confidence: "high" | "moderate" | "low" | "unknown";
  criteria: Array<Record<string, unknown>>;
  citations: string[];
  reasoning: string;
  icpVersion: number | null;
  evaluator: string | null;
  model: string | null;
  createdAt: string;
}

/** Is live discovery connected? Cheap, unauthenticated, leaks no secret. */
export async function discoveryStatus(): Promise<DiscoveryStatus> {
  try {
    const response = await fetch(ENDPOINT, { method: "GET" });
    if (!response.ok) return { configured: false, provider: "openai", model: null };
    return (await response.json()) as DiscoveryStatus;
  } catch {
    return { configured: false, provider: "openai", model: null };
  }
}

export interface DiscoverInput {
  organizationId: ID;
  query: string;
  limit?: number;
  onStage?: (stage: DiscoveryStage) => void;
}

export interface DiscoverOutcome {
  runId: ID | null;
  saved: number;
  rejected: number;
  returned: number;
}

/**
 * Run one discovery pass, reporting stages as they happen. Rejects with a plain
 * message when Scout could not complete — the board shows it as written.
 */
export async function discover(input: DiscoverInput): Promise<DiscoverOutcome> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error("Your session has expired. Sign in again to run discovery.");
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: input.query,
      organization_id: input.organizationId,
      ...(input.limit ? { limit: input.limit } : {}),
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(
      response.status === 401
        ? "Your session has expired. Sign in again to run discovery."
        : "Scout could not start a discovery run. Nothing was changed.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: DiscoverOutcome = { runId: null, saved: 0, rejected: 0, returned: 0 };
  let failure: string | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let stage: DiscoveryStage;
    try {
      stage = JSON.parse(line) as DiscoveryStage;
    } catch {
      return;
    }
    input.onStage?.(stage);
    if (stage.stage === "error") failure = stage.message;
    if (stage.stage === "done") {
      const data = stage.data ?? {};
      outcome = {
        runId: (data["run_id"] as ID | null) ?? null,
        saved: Number(data["saved"] ?? 0),
        rejected: Number(data["rejected"] ?? 0),
        returned: Number(data["returned"] ?? 0),
      };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(buffer);

  if (failure) throw new Error(failure);
  return outcome;
}

function toRun(row: Record<string, unknown>): DiscoveryRun {
  return {
    id: String(row["id"]),
    query: String(row["query"] ?? ""),
    status: (row["status"] as DiscoveryRun["status"]) ?? "running",
    model: (row["model"] as string | null) ?? null,
    icpVersion: (row["icp_version"] as number | null) ?? null,
    requestedCount: (row["requested_count"] as number | null) ?? null,
    resultCount: (row["result_count"] as number | null) ?? null,
    error: (row["error"] as string | null) ?? null,
    createdAt: String(row["created_at"] ?? ""),
    finishedAt: (row["finished_at"] as string | null) ?? null,
    meta: (row["response_meta"] as Record<string, unknown>) ?? {},
  };
}

/** Every sourcing pass this organization has run, newest first. */
export async function listDiscoveryRuns(organizationId: ID, limit = 20): Promise<DiscoveryRun[]> {
  const { data, error } = await supabase
    .from("scout_discovery_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toRun);
}

/** Every evaluation recorded for one company, newest first. */
export async function listProspectEvaluations(prospectId: ID): Promise<ProspectEvaluation[]> {
  const { data, error } = await supabase
    .from("prospect_evaluations")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    prospectId: String(row["prospect_id"]),
    runId: (row["discovery_run_id"] as ID | null) ?? null,
    score: Number(row["score"] ?? 0),
    light: ((row["fit_light"] as FitLight) ?? "neutral") as FitLight,
    confidence: (row["confidence"] as ProspectEvaluation["confidence"]) ?? "unknown",
    criteria: Array.isArray(row["criteria"]) ? (row["criteria"] as Record<string, unknown>[]) : [],
    citations: Array.isArray(row["citations"]) ? (row["citations"] as string[]) : [],
    reasoning: String(row["reasoning_summary"] ?? ""),
    icpVersion: (row["icp_version"] as number | null) ?? null,
    evaluator: (row["evaluator"] as string | null) ?? null,
    model: (row["model"] as string | null) ?? null,
    createdAt: String(row["created_at"] ?? ""),
  }));
}

export interface RecordEvaluationInput {
  organizationId: ID;
  prospectId: ID;
  userId: ID;
  evaluation: ScoutFitEvaluation;
  citations?: string[];
  observed?: unknown;
  inferred?: unknown;
  suggested?: unknown;
}

/**
 * Record one deterministic evaluation pass. Written for website research as
 * well as discovery, so a company's fit history is complete rather than only
 * covering the runs that came from market sourcing.
 */
export async function recordProspectEvaluation(input: RecordEvaluationInput): Promise<void> {
  const { evaluation } = input;
  const { error } = await supabase.from("prospect_evaluations").insert({
    organization_id: input.organizationId,
    prospect_id: input.prospectId,
    evaluator: "scout-research",
    evaluator_version: evaluation.evaluatorVersion,
    provider: "trust-tai",
    model: null,
    icp_version: evaluation.icpVersion,
    score: evaluation.score,
    fit_light: evaluation.light,
    confidence: evaluation.evidenceCount >= 3 ? "moderate" : "low",
    criteria: evaluation.criteria,
    observed: input.observed ?? [],
    inferred: input.inferred ?? {},
    suggested: input.suggested ?? {},
    citations: input.citations ?? [],
    reasoning_summary: evaluation.explanation,
    created_by: input.userId,
  });
  // A failed history write must never lose the research itself.
  if (error) console.warn("Scout could not record the evaluation history:", error.message);
}

export interface FeedbackInput {
  organizationId: ID;
  userId: ID;
  prospectId: ID;
  decision: "qualified" | "passed" | "fit_override";
  /** The human's own read of fit, when they stated one. */
  humanFit?: FitLight | null;
  reason?: string | null;
  /** Machine read at the time, so drift between model and humans is visible. */
  machineFit?: FitLight | null;
  machineScore?: number | null;
  companyName?: string;
  domain?: string;
}

/**
 * Record a human decision as calibration. Feedback sharpens how the ICP is
 * interpreted on later runs; it never rewrites the ICP itself.
 */
export async function recordScoutFeedback(input: FeedbackInput): Promise<void> {
  const { error } = await supabase.from("scout_feedback").insert({
    organization_id: input.organizationId,
    prospect_id: input.prospectId,
    decision: input.decision,
    human_fit: input.humanFit ?? null,
    machine_fit: input.machineFit ?? null,
    machine_score: input.machineScore ?? null,
    reason: input.reason ?? null,
    metadata: {
      company_name: input.companyName ?? null,
      domain: input.domain ?? null,
    },
    created_by: input.userId,
  });
  // Calibration is valuable but never blocking: a decision must still land.
  if (error) console.warn("Scout feedback was not recorded:", error.message);
}
