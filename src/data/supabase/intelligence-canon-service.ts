/**
 * Persistence for case learning.
 *
 * Two append-only tables, both intelligence rather than business truth:
 * `intelligence_cases` (a situation, the match, the decision and what happened)
 * and `pattern_outcomes` (what a recommendation off that match produced).
 *
 * Neither holds a copy of a prospect, relationship, roadmap or project. Cases
 * reference observation ids and entity refs only, so the rooms keep owning
 * their own state. Nothing is deleted: a changed conclusion is a new row.
 *
 * A missing table reads as an empty ledger so every surface still answers, and
 * refuses to write with the migration named rather than failing quietly.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { EntityRef, ID } from "@/domain/entities";
import type {
  CaseDiagnosisVerdict,
  IntelligenceCase,
  PatternOutcome,
  PatternResult,
} from "@/domain/intelligence-canon";

type Row = Record<string, unknown>;

const MISSING =
  "The Intelligence Canon ledger is not in this database yet. Apply docs/intelligence-canon-schema.sql.";

function missing(message: string): boolean {
  return message.includes("does not exist") || message.includes("schema cache");
}

function fail(error: { message: string }): never {
  throw new Error(missing(error.message) ? MISSING : error.message);
}

function text(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toCase(row: Row): IntelligenceCase {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    patternId: String(row["pattern_id"]),
    patternVersion: Number(row["pattern_version"] ?? 1),
    entities: (row["entities"] ?? []) as EntityRef[],
    evidenceRefs: (row["evidence_refs"] ?? []) as IntelligenceCase["evidenceRefs"],
    hypothesis: String(row["hypothesis"] ?? ""),
    humanDecision: String(row["human_decision"] ?? ""),
    decidedBy: String(row["decided_by"] ?? ""),
    decidedAt: String(row["decided_at"]),
    ...(text(row, "outcome") ? { outcome: text(row, "outcome")! } : {}),
    ...(text(row, "outcome_at") ? { outcomeAt: text(row, "outcome_at")! } : {}),
    diagnosisVerdict: (text(row, "diagnosis_verdict") ?? "unknown") as CaseDiagnosisVerdict,
    ...(text(row, "correction") ? { correction: text(row, "correction")! } : {}),
    ...(text(row, "lesson") ? { lesson: text(row, "lesson")! } : {}),
    createdAt: String(row["created_at"]),
  };
}

function toOutcome(row: Row): PatternOutcome {
  const hours = row["hours_to_outcome"];
  const refs = row["source_refs"];
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    patternId: String(row["pattern_id"]),
    patternVersion: Number(row["pattern_version"] ?? 1),
    ...(text(row, "case_id") ? { caseId: text(row, "case_id")! } : {}),
    recommendation: String(row["recommendation"] ?? ""),
    decision: (text(row, "decision") ?? "accepted") as PatternOutcome["decision"],
    result: (text(row, "result") ?? "unknown") as PatternResult,
    resultBecause: String(row["result_because"] ?? ""),
    ...(typeof hours === "number" ? { hoursToOutcome: hours } : {}),
    /* Rows written before provenance existed were all recorded by a person. */
    resultSource: (text(row, "result_source") ?? "human") as NonNullable<
      PatternOutcome["resultSource"]
    >,
    ...(Array.isArray(refs) ? { sourceRefs: refs.map((ref) => String(ref)) } : {}),
    ...(text(row, "observed_at") ? { observedAt: text(row, "observed_at")! } : {}),
    ...(text(row, "human_correction") ? { humanCorrection: text(row, "human_correction")! } : {}),
    recordedBy: String(row["recorded_by"] ?? ""),
    recordedAt: String(row["recorded_at"]),
  };
}

export const intelligenceCanonService = {
  /** Every case for the organization, newest first. Empty when not migrated. */
  async listCases(organizationId: ID): Promise<IntelligenceCase[]> {
    const { data, error } = await supabase
      .from("intelligence_cases")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return missing(error.message) ? [] : fail(error);
    return (data ?? []).map((row) => toCase(row as Row));
  },

  async listOutcomes(organizationId: ID): Promise<PatternOutcome[]> {
    const { data, error } = await supabase
      .from("pattern_outcomes")
      .select("*")
      .eq("organization_id", organizationId)
      .order("recorded_at", { ascending: false })
      .limit(400);
    if (error) return missing(error.message) ? [] : fail(error);
    return (data ?? []).map((row) => toOutcome(row as Row));
  },

  /** Append one case. Never updates an earlier row in place. */
  async saveCase(entry: IntelligenceCase): Promise<IntelligenceCase> {
    const { data, error } = await supabase
      .from("intelligence_cases")
      .insert({
        organization_id: entry.organizationId,
        pattern_id: entry.patternId,
        pattern_version: entry.patternVersion,
        entities: entry.entities,
        evidence_refs: entry.evidenceRefs,
        hypothesis: entry.hypothesis,
        human_decision: entry.humanDecision,
        decided_by: entry.decidedBy,
        decided_at: entry.decidedAt,
        outcome: entry.outcome ?? null,
        outcome_at: entry.outcomeAt ?? null,
        diagnosis_verdict: entry.diagnosisVerdict,
        correction: entry.correction ?? null,
        lesson: entry.lesson ?? null,
      })
      .select("*")
      .single();
    if (error) fail(error);
    return toCase(data as Row);
  },

  async saveOutcome(entry: PatternOutcome): Promise<PatternOutcome> {
    const base = {
      organization_id: entry.organizationId,
      pattern_id: entry.patternId,
      pattern_version: entry.patternVersion,
      case_id: entry.caseId ?? null,
      recommendation: entry.recommendation,
      decision: entry.decision,
      result: entry.result,
      result_because: entry.resultBecause,
      hours_to_outcome: entry.hoursToOutcome ?? null,
      human_correction: entry.humanCorrection ?? null,
      recorded_by: entry.recordedBy,
      recorded_at: entry.recordedAt,
    };
    const provenance = {
      result_source: entry.resultSource ?? "human",
      source_refs: entry.sourceRefs ?? [],
      observed_at: entry.observedAt ?? entry.recordedAt,
    };

    const first = await supabase
      .from("pattern_outcomes")
      .insert({ ...base, ...provenance })
      .select("*")
      .single();
    if (!first.error) return toOutcome(first.data as Row);

    /* A database without the provenance columns still records the result. */
    if (!/column|schema cache/i.test(first.error.message)) fail(first.error);
    const { data, error } = await supabase
      .from("pattern_outcomes")
      .insert(base)
      .select("*")
      .single();
    if (error) fail(error);
    return toOutcome(data as Row);
  },


  /**
   * Open a case only if the same decision, about the same reading, on the same
   * evidence, is not already in the ledger.
   *
   * The tables are append only and hold no natural key, so idempotency is
   * enforced here by content: a retry, a double click or a re-render resolves
   * to the row already written instead of a second identical case.
   */
  async openCaseOnce(entry: IntelligenceCase): Promise<{ entry: IntelligenceCase; created: boolean }> {
    const existing = await intelligenceCanonService.listCases(entry.organizationId);
    const match = existing.find((row) => caseFingerprint(row) === caseFingerprint(entry));
    if (match) return { entry: match, created: false };
    return { entry: await intelligenceCanonService.saveCase(entry), created: true };
  },

  /** Append an outcome unless the same reading of the same case is already there. */
  async recordOutcomeOnce(
    entry: PatternOutcome,
  ): Promise<{ entry: PatternOutcome; created: boolean }> {
    const existing = await intelligenceCanonService.listOutcomes(entry.organizationId);
    const match = existing.find((row) => outcomeFingerprint(row) === outcomeFingerprint(entry));
    if (match) return { entry: match, created: false };
    return { entry: await intelligenceCanonService.saveOutcome(entry), created: true };
  },
};

/** Content identity of a case: the reading, the evidence, and the decision. */
export function caseFingerprint(entry: IntelligenceCase): string {
  const refs = entry.evidenceRefs
    .map((ref) => `${ref.kind}:${ref.id}`)
    .sort()
    .join("|");
  return [
    entry.organizationId,
    entry.patternId,
    entry.patternVersion,
    refs,
    entry.humanDecision.trim(),
    entry.correction?.trim() ?? "",
  ].join("::");
}

/** Content identity of an outcome: which case, what result, and why. */
export function outcomeFingerprint(entry: PatternOutcome): string {
  return [
    entry.organizationId,
    entry.patternId,
    entry.caseId ?? "",
    entry.result,
    entry.resultBecause.trim(),
    entry.humanCorrection?.trim() ?? "",
  ].join("::");
}

