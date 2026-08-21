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
  /** Source references the result stands on. Empty when the shape has cleared. */
  evidenceRefs: string[];
  hoursToOutcome: number;
  /** When the state behind the result was read. */
  observedAt: string;
}

/**
 * One condition still visible in a room right now.
 *
 * This is current evidence only. Nothing here comes from an earlier outcome,
 * and prior experience never travels in this shape.
 */
export interface StateCondition {
  kind: string;
  statement: string;
  /** Room-native references, for example `projects:state:<id>`. */
  sourceRefs: string[];
  observedAt: string;
}

/**
 * An explicit state the owning room already recorded about one record.
 *
 * This is not interpretation. Each signal names a state that exists in the
 * room's own schema, such as a project closed, a company passed, a decision
 * declined, a promise released. Owning room truth settles a case before any
 * elapsed time rule is allowed to speak, and an ambiguous state settles
 * nothing at all.
 */
export type TerminalDisposition = "resolved" | "abandoned" | "ambiguous";

export interface TerminalSignal {
  entity: { type: string; id: string };
  /** Observation kinds this recorded state can honestly settle. */
  kinds: string[];
  disposition: TerminalDisposition;
  statement: string;
  sourceRefs: string[];
  /** When the room last changed the record, when the room stores it. */
  changedAt?: string;
  observedAt: string;
}

/**
 * The bounded business state a reconciliation may reason over.
 *
 * `readableKinds` is the honest part: a kind absent from it was not read
 * confidently, so any case that depends on it stays unknown rather than being
 * treated as cleared.
 */
export interface ReconciliationSnapshot {
  organizationId: string;
  now: string;
  readableKinds: string[];
  conditions: StateCondition[];
  /** Explicit terminal or resolution states the owning rooms recorded. */
  terminal?: TerminalSignal[];
  /** Rooms that could not be read on this pass. */
  unreadable: string[];
}


/** Wrap already derived observations as a snapshot, so one evaluator serves both paths. */
export function snapshotFromObservations(input: {
  organizationId: string;
  observations: Observation[];
  now: string;
  readableKinds?: string[];
}): ReconciliationSnapshot {
  return {
    organizationId: input.organizationId,
    now: input.now,
    readableKinds: input.readableKinds ?? [...VERIFIABLE_KINDS],
    conditions: input.observations
      .filter((observation) => (VERIFIABLE_KINDS as readonly string[]).includes(observation.kind))
      .map((observation) => ({
        kind: observation.kind,
        statement: observation.statement,
        sourceRefs: observation.contextRefs?.length ? observation.contextRefs : [observation.id],
        observedAt: input.now,
      })),
    unreadable: [],
  };
}

/**
 * The single interpretation of a deterministic check.
 *
 * Success only when every checkable condition the reading rested on was read
 * confidently and is gone. Failure only when the same condition is still there
 * long after the decision. Everything else is unknown, which writes nothing.
 */
export function evaluateOpenCase(input: {
  entry: IntelligenceCase;
  snapshot: ReconciliationSnapshot;
}): Reconciliation | null {
  const { entry, snapshot } = input;
  const kinds = checkableKinds(entry.patternId);
  if (kinds.length === 0) return null;

  /* A kind we could not read is not an absence. It is unknown. */
  if (!kinds.every((kind) => snapshot.readableKinds.includes(kind))) return null;

  const decidedAt = Date.parse(entry.decidedAt);
  const nowMs = Date.parse(snapshot.now);
  if (Number.isNaN(decidedAt) || Number.isNaN(nowMs) || nowMs <= decidedAt) return null;
  const hours = Math.round((nowMs - decidedAt) / HOUR);

  const still = snapshot.conditions.filter((condition) => kinds.includes(condition.kind));

  if (still.length === 0) {
    return {
      caseId: entry.id,
      patternId: entry.patternId,
      result: "success",
      because: "The shape this reading rested on is no longer visible in the rooms that own it.",
      evidenceRefs: [],
      hoursToOutcome: hours,
      observedAt: snapshot.now,
    };
  }

  if (hours >= FAILURE_AFTER_HOURS) {
    return {
      caseId: entry.id,
      patternId: entry.patternId,
      result: "failure",
      because: `The same shape is still being observed ${Math.round(hours / 24)} days after the decision: ${still[0]!.statement}`,
      evidenceRefs: still.flatMap((condition) => condition.sourceRefs),
      hoursToOutcome: hours,
      observedAt: snapshot.now,
    };
  }

  return null;
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
  return evaluateOpenCase({
    entry: input.entry,
    snapshot: snapshotFromObservations({
      organizationId: input.entry.organizationId,
      observations: input.observations,
      now: input.now,
    }),
  });
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
    resultSource: "current_state",
    sourceRefs: input.reconciliation.evidenceRefs,
    observedAt: input.reconciliation.observedAt,
    ...(input.entry.correction ? { humanCorrection: input.entry.correction } : {}),
    recordedBy: input.recordedBy,
    recordedAt: input.now,
  };
}
