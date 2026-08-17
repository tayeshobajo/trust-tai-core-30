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

/** A unique-key clash means the row is already there, not that anything failed. */
function isDuplicate(error: { code?: string | undefined; message: string }): boolean {
  return error.code === "23505" || error.message.toLowerCase().includes("duplicate key");
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
    ...(text(row, "recommendation_id")
      ? { recommendationId: text(row, "recommendation_id")! }
      : {}),
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
 * Append one measurement, without ever mutating one.
 *
 * The live tables grant `SELECT, INSERT` only — no UPDATE, by design — so a
 * conflicting write must resolve, not overwrite. An observation's id is its
 * content, so a duplicate key means "this exact reading is already recorded":
 * the stored row is returned untouched and nothing is double-counted.
 */
export async function recordObservation(
  observation: ActionObservation,
): Promise<ActionObservation> {
  const { data, error } = await supabase
    .from("conductor_observations")
    .insert({
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
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (isDuplicate(error)) return (await readObservation(observation.id)) ?? observation;
    fail(error);
  }
  return data ? toObservation(data as Row) : observation;
}

/** The row already there, read back rather than rewritten. */
async function readObservation(id: ID): Promise<ActionObservation | undefined> {
  const { data, error } = await supabase
    .from("conductor_observations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return undefined;
  return toObservation(data as Row);
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
    ...(text(row, "recommendation_id")
      ? { recommendationId: text(row, "recommendation_id")! }
      : {}),
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

/**
 * Append one lesson. Prior records are superseded, never overwritten — and
 * with INSERT-only grants there is no path that could overwrite one.
 */
export async function recordLearning(record: LearningRecord): Promise<LearningRecord> {
  const { data, error } = await supabase
    .from("conductor_learning")
    .insert({
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
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (isDuplicate(error)) {
      const { data: existing } = await supabase
        .from("conductor_learning")
        .select("*")
        .eq("id", record.id)
        .maybeSingle();
      return existing ? toLearning(existing as Row) : record;
    }
    fail(error);
  }
  return data ? toLearning(data as Row) : record;
}

/* ------------------------------------------------------ human correction */

/**
 * A person's own reading of what happened.
 *
 * This is the only way a human overrules the Conductor's inference, and it is
 * still append-only: a new `decided` record that supersedes the standing one.
 * Nothing is edited, nothing is deleted, and the person who said it is named
 * on the record so future reasoning knows whose word it is.
 */
export async function correctLearning(input: {
  organizationId: ID;
  scope: { owningApp: string; operation: string };
  statement: string;
  correctedBy: { id: ID; label: string };
  standing?: LearningRecord | undefined;
  expectedSignal?: string;
  now?: string;
}): Promise<LearningRecord> {
  const at = input.now ?? new Date().toISOString();
  const statement = input.statement.trim();
  if (statement.length === 0) {
    throw new Error("A correction needs a sentence saying what actually happened.");
  }
  const record: LearningRecord = {
    id: `learning:${input.scope.owningApp}:${input.scope.operation}:decided:${at}`,
    organizationId: input.organizationId,
    scope: input.scope,
    sourceActionIds: input.standing?.sourceActionIds ?? [],
    sourceObservationIds: input.standing?.sourceObservationIds ?? [],
    hypothesis: input.standing?.hypothesis ?? "The Conductor's reading of this operation.",
    expectedSignal: input.expectedSignal ?? input.standing?.expectedSignal ?? "—",
    observedResult: "A person corrected the Conductor's reading.",
    evidence: [{ label: `${input.correctedBy.label} corrected this reading`, kind: "human" }],
    confidence: "high",
    lesson: statement,
    basis: "decided",
    /* A person's word needs no evidence threshold. */
    isRule: true,
    grantsAuthority: false,
    recordedAt: at,
    ...(input.standing ? { supersedes: input.standing.id } : {}),
  };
  return recordLearning(record);
}
