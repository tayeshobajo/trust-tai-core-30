/**
 * Scheduled reconciliation of open intelligence cases.
 *
 * A case should not stay open just because nobody opened the Conductor. Once
 * an hour this reads the canonical activity stream and settles the open cases
 * a room event has already answered, by exact entity reference only.
 *
 * Deliberate limits:
 *  - bounded work per run, so a backlog never becomes a storm
 *  - a single-flight lease in the database, so two runs never overlap
 *  - at most one outcome per case, written through content-fingerprint dedupe
 *  - unknown writes nothing, and stays open
 *  - no downstream execution, no model judging success or failure
 */

import type { ActivityEvent } from "@/domain/activity";
import type { IntelligenceCase, PatternOutcome } from "@/domain/intelligence-canon";
import { outcomeFromRoomEvent, roomEventOutcomes } from "@/data/intelligence/canon/room-events";
import { openCases } from "@/data/intelligence/canon/experience";
import { outcomeFingerprint } from "@/data/supabase/intelligence-canon-service";

/** Never process more than this many open cases in one run. */
export const RUN_CASE_LIMIT = 100;
/** The job may not start again inside this window. */
export const MIN_RUN_INTERVAL_MINUTES = 55;
/** A crashed run releases its lease after this long. */
export const LEASE_MINUTES = 10;

export interface ReconcileRunReport {
  organizationId: string;
  casesConsidered: number;
  outcomesWritten: number;
  unknownLeftOpen: number;
  skipped?: "recent_run" | "lease_held" | "no_open_cases";
}

type Client = {
  from: (table: string) => any;
};

function toCase(row: Record<string, unknown>): IntelligenceCase {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    patternId: String(row["pattern_id"]),
    patternVersion: Number(row["pattern_version"] ?? 1),
    entities: (row["entities"] ?? []) as IntelligenceCase["entities"],
    evidenceRefs: (row["evidence_refs"] ?? []) as IntelligenceCase["evidenceRefs"],
    hypothesis: String(row["hypothesis"] ?? ""),
    humanDecision: String(row["human_decision"] ?? ""),
    decidedBy: String(row["decided_by"] ?? ""),
    decidedAt: String(row["decided_at"]),
    diagnosisVerdict: (row["diagnosis_verdict"] ?? "unknown") as IntelligenceCase["diagnosisVerdict"],
    ...(typeof row["correction"] === "string" ? { correction: row["correction"] as string } : {}),
    createdAt: String(row["created_at"] ?? row["decided_at"]),
  };
}

function toOutcome(row: Record<string, unknown>): PatternOutcome {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    patternId: String(row["pattern_id"]),
    patternVersion: Number(row["pattern_version"] ?? 1),
    ...(typeof row["case_id"] === "string" ? { caseId: row["case_id"] as string } : {}),
    recommendation: String(row["recommendation"] ?? ""),
    decision: (row["decision"] ?? "accepted") as PatternOutcome["decision"],
    result: (row["result"] ?? "unknown") as PatternOutcome["result"],
    resultBecause: String(row["result_because"] ?? ""),
    recordedBy: String(row["recorded_by"] ?? ""),
    recordedAt: String(row["recorded_at"]),
  };
}

function toEvent(row: Record<string, unknown>): ActivityEvent {
  const payload = (row["payload"] ?? {}) as Record<string, unknown>;
  const ref = typeof payload["entity_ref"] === "string" ? (payload["entity_ref"] as string) : null;
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"] ?? ""),
    name: String(row["event_type"] ?? "") as ActivityEvent["name"],
    subject: {
      type: (row["entity_type"] ?? "activity") as ActivityEvent["subject"]["type"],
      id: ref ?? String(row["entity_id"] ?? ""),
    },
    summary: String(row["summary"] ?? ""),
    payload,
    provenance: {
      appId: String(row["app_key"] ?? "core"),
      actor: { type: "user", id: String(row["actor_user_id"] ?? "") },
      observedAt: String(row["occurred_at"] ?? ""),
      confidence: "observed",
    },
    occurredAt: String(row["occurred_at"] ?? ""),
  } as ActivityEvent;
}

/**
 * One organization's run. Returns what it did, including doing nothing, which
 * is the ordinary and correct result on most hours.
 */
export async function reconcileOrganization(
  client: Client,
  organizationId: string,
  now = new Date(),
): Promise<ReconcileRunReport> {
  const base: ReconcileRunReport = {
    organizationId,
    casesConsidered: 0,
    outcomesWritten: 0,
    unknownLeftOpen: 0,
  };

  /* Not more often than hourly, and never alongside a live run. */
  const { data: recent } = await client
    .from("intelligence_reconciliation_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(1);
  const last = (recent ?? [])[0] as Record<string, unknown> | undefined;
  if (last) {
    const startedAt = Date.parse(String(last["started_at"]));
    const leaseUntil = Date.parse(String(last["lease_expires_at"]));
    if (last["status"] === "running" && leaseUntil > now.getTime()) {
      return { ...base, skipped: "lease_held" };
    }
    if (now.getTime() - startedAt < MIN_RUN_INTERVAL_MINUTES * 60_000) {
      return { ...base, skipped: "recent_run" };
    }
  }

  const { data: caseRows } = await client
    .from("intelligence_cases")
    .select("*")
    .eq("organization_id", organizationId)
    .order("decided_at", { ascending: true })
    .limit(400);
  const { data: outcomeRows } = await client
    .from("pattern_outcomes")
    .select("*")
    .eq("organization_id", organizationId)
    .limit(800);

  const cases = ((caseRows ?? []) as Record<string, unknown>[]).map(toCase);
  const outcomes = ((outcomeRows ?? []) as Record<string, unknown>[]).map(toOutcome);
  const open = openCases(cases, outcomes).slice(0, RUN_CASE_LIMIT);
  if (open.length === 0) return { ...base, skipped: "no_open_cases" };

  /* Take the lease before doing any work. */
  const { data: leaseRow } = await client
    .from("intelligence_reconciliation_runs")
    .insert({
      organization_id: organizationId,
      started_at: now.toISOString(),
      status: "running",
      lease_expires_at: new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString(),
      cases_considered: open.length,
    })
    .select("*")
    .single();
  const runId = leaseRow ? String((leaseRow as Record<string, unknown>)["id"]) : null;

  const finish = async (report: ReconcileRunReport, note?: string) => {
    if (!runId) return;
    await client
      .from("intelligence_reconciliation_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: note ? "failed" : "done",
        outcomes_written: report.outcomesWritten,
        unknown_left_open: report.unknownLeftOpen,
        note: note ?? null,
      })
      .eq("id", runId);
  };

  try {
    const earliest = open[0]?.decidedAt ?? now.toISOString();
    const { data: eventRows } = await client
      .from("activities")
      .select("*")
      .eq("organization_id", organizationId)
      .gte("occurred_at", earliest)
      .order("occurred_at", { ascending: true })
      .limit(1000);
    const events = ((eventRows ?? []) as Record<string, unknown>[]).map(toEvent);

    const settled = roomEventOutcomes({ cases: open, events });
    const known = new Set(outcomes.map((row) => outcomeFingerprint(row)));
    let written = 0;

    for (const event of settled) {
      const entry = open.find((row) => row.id === event.caseId);
      if (!entry) continue;
      const draft = outcomeFromRoomEvent({
        entry,
        event,
        recordedBy: entry.decidedBy,
        now: now.toISOString(),
      });
      const fingerprint = outcomeFingerprint({ id: "", ...draft } as PatternOutcome);
      if (known.has(fingerprint)) continue;
      known.add(fingerprint);

      const { error } = await client.from("pattern_outcomes").insert({
        organization_id: draft.organizationId,
        pattern_id: draft.patternId,
        pattern_version: draft.patternVersion,
        case_id: draft.caseId ?? null,
        recommendation: draft.recommendation,
        decision: draft.decision,
        result: draft.result,
        result_because: draft.resultBecause,
        hours_to_outcome: draft.hoursToOutcome ?? null,
        human_correction: draft.humanCorrection ?? null,
        recorded_by: draft.recordedBy,
        recorded_at: draft.recordedAt,
      });
      if (!error) written += 1;
    }

    const report: ReconcileRunReport = {
      organizationId,
      casesConsidered: open.length,
      outcomesWritten: written,
      unknownLeftOpen: open.length - written,
    };
    await finish(report);
    return report;
  } catch (error) {
    const report = { ...base, casesConsidered: open.length, unknownLeftOpen: open.length };
    await finish(report, error instanceof Error ? error.message : "run failed");
    throw error;
  }
}

/** Every organization with at least one case, bounded. */
export async function organizationsWithCases(client: Client): Promise<string[]> {
  const { data } = await client
    .from("intelligence_cases")
    .select("organization_id")
    .order("created_at", { ascending: false })
    .limit(1000);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    ids.add(String(row["organization_id"]));
  }
  return [...ids].slice(0, 25);
}
