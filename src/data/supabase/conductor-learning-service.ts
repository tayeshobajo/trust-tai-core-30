/**
 * Persistence for the outcome and learning loop (Conductor V3).
 *
 * Two append-only tables, both intelligence rather than business truth:
 * `conductor_observations` (what was found in the owning room when the
 * expected signal was checked) and `conductor_learning` (what the Conductor
 * concluded about its own recommendations, with the evidence attached).
 *
 * Neither holds a copy of a prospect, relationship, roadmap or project — only
 * references and the evidence sentences behind a reading. Nothing is edited or
 * deleted: a changed conclusion is a new row that supersedes the old one.
 *
 * A missing table reads as an empty ledger so the Conductor still answers, and
 * refuses to *write* with the migration named rather than failing silently.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  ActionObservation,
  LearningRecord,
  MetricClass,
  OutcomeStatus,
  ResultClassification,
  TruthClass,
} from "@/domain/outcomes";

type Row = Record<string, unknown>;

const MISSING =
  "The Conductor learning ledger is not in this database yet. Apply docs/conductor-v3-schema.sql.";

function text(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function json<T>(row: Row, key: string, fallback: T): T {
  const value = row[key];
  return value === null || value === undefined ? fallback : (value as T);
}

function fail(error: { message: string }): never {
  throw new Error(error.message.includes("does not exist") ? MISSING : error.message);
}

/* --------------------------------------------------------- observations */

function toObservation(row: Row): ActionObservation {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    actionId: String(row["action_id"]),
    ...(text(row, "recommendation_id") ? { recommendationId: text(row, "recommendation_id")! } : {}),
    ...(text(row, "answer_id") ? { answerId: text(row, "answer_id")! } : {}),
    ...(text(row, "plan_id") ? { planId: text(row, "plan_id")! } : {}),
    owningApp: text(row, "owning_app") ?? "unknown",
    operation: text(row, "operation") ?? "unknown",
    expectedSignal: json(row, "expected_signal", {
      statement: "No signal declared.",
      observedIn: text(row, "owning_app") ?? "unknown",
    }),
    ...(row["observation_window"]
      ? { observationWindow: json(row, "observation_window", undefined as never) }
      : {}),
    observedEvidence: json(row, "observed_evidence", []),
    result: (text(row, "result") ?? "unknown") as ResultClassification,
    truth: (text(row, "truth") ?? "unknown") as TruthClass,
    confidence: (text(row, "confidence") ?? "unknown") as ActionObservation["confidence"],
    ...(text(row, "metric_key") ? { metricKey: text(row, "metric_key")! } : {}),
    ...(text(row, "metric_class")
      ? { metricClass: text(row, "metric_class")! as MetricClass }
      : {}),
    outcomeStatus: (text(row, "outcome_status") ?? "pending") as OutcomeStatus,
    measuredAt: text(row, "measured_at") ?? new Date().toISOString(),
    ...(text(row, "observed_at") ? { observedAt: text(row, "observed_at")! } : {}),
    provenance: json(row, "provenance", {
      appId: "conductor",
      actor: { type: "system" as const, id: "conductor" },
      observedAt: text(row, "measured_at") ?? new Date().toISOString(),
    }),
  };
}

export async function loadObservations(organizationId: ID): Promise<ActionObservation[]> {
  const { data, error } = await supabase
    .from("conductor_observations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("measured_at", { ascending: false })
    .limit(300);
  if (error) return [];
  return (data ?? []).map((row) => toObservation(row as Row));
}

/**
 * Append one measurement. Unique on (action, measured_at) so re-running the
 * observer for the same moment cannot double-count a single result.
 */
export async function recordObservation(
  observation: ActionObservation,
): Promise<ActionObservation> {
  const { data, error } = await supabase
    .from("conductor_observations")
    .upsert(
      {
        id: observation.id,
        organization_id: observation.organizationId,
        action_id: observation.actionId,
        recommendation_id: observation.recommendationId ?? null,
        answer_id: observation.answerId ?? null,
        plan_id: observation.planId ?? null,
        owning_app: observation.owningApp,
        operation: observation.operation,
        expected_signal: observation.expectedSignal,
        observation_window: observation.observationWindow ?? null,
        observed_evidence: observation.observedEvidence,
        result: observation.result,
        truth: observation.truth,
        confidence: observation.confidence,
        metric_key: observation.metricKey ?? null,
        metric_class: observation.metricClass ?? null,
        outcome_status: observation.outcomeStatus,
        measured_at: observation.measuredAt,
        observed_at: observation.observedAt ?? null,
        provenance: observation.provenance,
      },
      { onConflict: "id" },
    )
    .select("*")
    .maybeSingle();
  if (error) fail(error);
  return data ? toObservation(data as Row) : observation;
}

/* -------------------------------------------------------------- learning */

function toLearning(row: Row): LearningRecord {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    scope: {
      owningApp: text(row, "owning_app") ?? "unknown",
      operation: text(row, "operation") ?? "unknown",
    },
    sourceActionIds: json(row, "source_action_ids", [] as string[]),
    sourceObservationIds: json(row, "source_observation_ids", [] as string[]),
    ...(text(row, "recommendation_id") ? { recommendationId: text(row, "recommendation_id")! } : {}),
    hypothesis: text(row, "hypothesis") ?? "",
    expectedSignal: text(row, "expected_signal") ?? "",
    observedResult: text(row, "observed_result") ?? "",
    evidence: json(row, "evidence", []),
    confidence: (text(row, "confidence") ?? "none") as LearningRecord["confidence"],
    lesson: text(row, "lesson") ?? "",
    basis: (text(row, "basis") ?? "inferred") as TruthClass,
    isRule: row["is_rule"] === true,
    /* Typed false, and re-asserted on read: learning never grants authority. */
    grantsAuthority: false,
    recordedAt: text(row, "recorded_at") ?? new Date().toISOString(),
    ...(text(row, "supersedes") ? { supersedes: text(row, "supersedes")! } : {}),
    ...(text(row, "contradicts") ? { contradicts: text(row, "contradicts")! } : {}),
  };
}

export async function loadLearning(organizationId: ID): Promise<LearningRecord[]> {
  const { data, error } = await supabase
    .from("conductor_learning")
    .select("*")
    .eq("organization_id", organizationId)
    .order("recorded_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []).map((row) => toLearning(row as Row));
}

/** Append one lesson. Prior records are superseded, never overwritten. */
export async function recordLearning(record: LearningRecord): Promise<LearningRecord> {
  const { data, error } = await supabase
    .from("conductor_learning")
    .upsert(
      {
        id: record.id,
        organization_id: record.organizationId,
        owning_app: record.scope.owningApp,
        operation: record.scope.operation,
        source_action_ids: record.sourceActionIds,
        source_observation_ids: record.sourceObservationIds,
        recommendation_id: record.recommendationId ?? null,
        hypothesis: record.hypothesis,
        expected_signal: record.expectedSignal,
        observed_result: record.observedResult,
        evidence: record.evidence,
        confidence: record.confidence,
        lesson: record.lesson,
        basis: record.basis,
        is_rule: record.isRule,
        recorded_at: record.recordedAt,
        supersedes: record.supersedes ?? null,
        contradicts: record.contradicts ?? null,
      },
      { onConflict: "id" },
    )
    .select("*")
    .maybeSingle();
  if (error) fail(error);
  return data ? toLearning(data as Row) : record;
}
