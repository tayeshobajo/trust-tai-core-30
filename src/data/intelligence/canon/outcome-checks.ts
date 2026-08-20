/**
 * Deterministic outcome reconciliation.
 *
 * A case says a person decided something about a reading. This asks the only
 * honest follow up question: is the shape the reading rested on still there?
 *
 * No model judges the result. The check reads the same observations the suite
 * already made, and it will say "nothing readable yet" far more often than it
 * says success or failure. Time alone is never a result: a case is only called
 * failed while the same shape is still being observed.
 */

import type { Observation } from "@/domain/intelligence-engine";
import type {
  IntelligenceCase,
  PatternOutcome,
  PatternResult,
} from "@/domain/intelligence-canon";

import { patternById } from "./patterns";

/**
 * Observation kinds that clear cleanly when the underlying work is done, so
 * their absence is real news rather than a gap in what the suite can read.
 */
export const VERIFIABLE_KINDS = [
  "reply_debt",
  "strong_fit_unreviewed",
  "project_delayed",
  "project_blocked",
  "roadmap_direction_undecided",
  "open_decisions",
  "pipeline_unrouted",
  "commitment_overdue",
  "no_active_project",
] as const;

/** How long the same shape must persist after a decision before it reads as failure. */
export const FAILURE_AFTER_HOURS = 168;

const HOUR = 3_600_000;

/** The trigger kinds of a pattern that can be checked deterministically. */
export function checkableKinds(patternId: string): string[] {
  const pattern = patternById(patternId);
  if (!pattern) return [];
  return pattern.triggers
    .filter((trigger) => !trigger.optional)
    .map((trigger) => trigger.observationKind)
    .filter((kind) => (VERIFIABLE_KINDS as readonly string[]).includes(kind));
}

/** Whether a case can be reconciled without a person telling us the answer. */
export function canReconcile(patternId: string): boolean {
  return checkableKinds(patternId).length > 0;
}

export interface Reconciliation {
  caseId: string;
  patternId: string;
  result: Exclude<PatternResult, "unknown">;
  because: string;
  /** Observation ids the result stands on. Empty when the shape has cleared. */
  evidenceRefs: string[];
  hoursToOutcome: number;
}

export interface ReconcileInput {
  entry: IntelligenceCase;
  observations: Observation[];
  now: string;
}

/**
 * One case against what the rooms currently show. Returns nothing when the
 * result is not readable yet, which is the common and correct answer.
 */
export function reconcileCase(input: ReconcileInput): Reconciliation | null {
  const kinds = checkableKinds(input.entry.patternId);
  if (kinds.length === 0) return null;

  const decidedAt = Date.parse(input.entry.decidedAt);
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(decidedAt) || Number.isNaN(nowMs) || nowMs <= decidedAt) return null;
  const hours = Math.round((nowMs - decidedAt) / HOUR);

  const still = input.observations.filter((observation) => kinds.includes(observation.kind));

  if (still.length === 0) {
    return {
      caseId: input.entry.id,
      patternId: input.entry.patternId,
      result: "success",
      because: "The shape this reading rested on is no longer visible in the rooms that own it.",
      evidenceRefs: [],
      hoursToOutcome: hours,
    };
  }

  if (hours >= FAILURE_AFTER_HOURS) {
    return {
      caseId: input.entry.id,
      patternId: input.entry.patternId,
      result: "failure",
      because: `The same shape is still being observed ${Math.round(hours / 24)} days after the decision: ${still[0]!.statement}`,
      evidenceRefs: still.map((observation) => observation.id),
      hoursToOutcome: hours,
    };
  }

  return null;
}

/** Reconcile a set of open cases. Cases with no readable result are left alone. */
export function reconcileCases(input: {
  cases: IntelligenceCase[];
  observations: Observation[];
  now: string;
}): Reconciliation[] {
  return input.cases
    .map((entry) => reconcileCase({ entry, observations: input.observations, now: input.now }))
    .filter((row): row is Reconciliation => row !== null);
}

/** The outcome row a reconciliation becomes. Never invents a decision. */
export function outcomeFromReconciliation(input: {
  entry: IntelligenceCase;
  reconciliation: Reconciliation;
  recordedBy: string;
  now: string;
}): Omit<PatternOutcome, "id"> {
  return {
    organizationId: input.entry.organizationId,
    patternId: input.entry.patternId,
    patternVersion: input.entry.patternVersion,
    caseId: input.entry.id,
    recommendation: input.entry.hypothesis,
    decision: "accepted",
    result: input.reconciliation.result,
    resultBecause: input.reconciliation.because,
    hoursToOutcome: input.reconciliation.hoursToOutcome,
    ...(input.entry.correction ? { humanCorrection: input.entry.correction } : {}),
    recordedBy: input.recordedBy,
    recordedAt: input.now,
  };
}
