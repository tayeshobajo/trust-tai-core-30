/**
 * Case learning: how a resolved situation makes the next diagnosis better.
 *
 * Pure logic only. Building a case, recording an outcome, reading what the
 * outcomes so far suggest, and refusing to change canonical pattern text on
 * that basis. Persistence lives in the service; governance lives here.
 *
 * Laws:
 *   - A human correction outranks anything inferred from a result.
 *   - One result is not a rule. Guidance needs repeated, consistent evidence.
 *   - Learning never expands authority. Nothing here authorises an action.
 *   - Canonical pattern text is never mutated automatically. Repeated evidence
 *     produces a revision proposal that a person still has to accept.
 */

import type { ID, ISODateTime } from "@/domain/entities";
import {
  PATTERN_LESSON_THRESHOLD,
  type CaseDiagnosisVerdict,
  type IntelligenceCase,
  type PatternMatch,
  type PatternOutcome,
  type PatternResult,
  type PatternRevisionProposal,
} from "@/domain/intelligence-canon";
import type { EntityRef } from "@/domain/entities";

import { patternById } from "./patterns";

export interface OpenCaseInput {
  organizationId: ID;
  match: PatternMatch;
  entities: EntityRef[];
  hypothesis: string;
  humanDecision: string;
  decidedBy: ID;
  now: ISODateTime;
}

/**
 * A case, at the moment a person decided something about a match.
 *
 * Evidence is referenced, never copied: the case points at observation ids so
 * the rooms keep owning their own state.
 */
export function openCase(input: OpenCaseInput): IntelligenceCase {
  const pattern = patternById(input.match.patternId);
  return {
    id: `case:${input.match.patternId}:${input.now}`,
    organizationId: input.organizationId,
    patternId: input.match.patternId,
    patternVersion: pattern?.version ?? 1,
    entities: input.entities,
    evidenceRefs: input.match.matched.map((entry) => ({
      kind: "observation" as const,
      id: entry.observationId,
    })),
    hypothesis: input.hypothesis,
    humanDecision: input.humanDecision,
    decidedBy: input.decidedBy,
    decidedAt: input.now,
    diagnosisVerdict: "unknown",
    createdAt: input.now,
  };
}

export interface ResolveCaseInput {
  outcome: string;
  outcomeAt: ISODateTime;
  verdict: CaseDiagnosisVerdict;
  /** The person's words when the reading was wrong. Outranks inference. */
  correction?: string;
  lesson?: string;
}

/** Resolving a case never rewrites the decision or the evidence it rested on. */
export function resolveCase(
  existing: IntelligenceCase,
  input: ResolveCaseInput,
): IntelligenceCase {
  return {
    ...existing,
    outcome: input.outcome,
    outcomeAt: input.outcomeAt,
    diagnosisVerdict: input.verdict,
    ...(input.correction ? { correction: input.correction } : {}),
    ...(input.lesson ? { lesson: input.lesson } : {}),
  };
}

export interface RecordOutcomeInput {
  organizationId: ID;
  match: PatternMatch;
  caseId?: ID;
  recommendation: string;
  decision: PatternOutcome["decision"];
  result: PatternResult;
  resultBecause: string;
  decidedAt: ISODateTime;
  observedAt?: ISODateTime;
  humanCorrection?: string;
  recordedBy: ID;
  now: ISODateTime;
}

export function recordPatternOutcome(input: RecordOutcomeInput): PatternOutcome {
  const pattern = patternById(input.match.patternId);
  const hours =
    input.observedAt !== undefined
      ? Math.max(
          0,
          Math.round(
            (Date.parse(input.observedAt) - Date.parse(input.decidedAt)) / 3_600_000,
          ),
        )
      : undefined;

  return {
    id: `pattern-outcome:${input.match.patternId}:${input.now}`,
    organizationId: input.organizationId,
    patternId: input.match.patternId,
    patternVersion: pattern?.version ?? 1,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    recommendation: input.recommendation,
    decision: input.decision,
    result: input.result,
    resultBecause: input.resultBecause,
    ...(hours === undefined ? {} : { hoursToOutcome: hours }),
    ...(input.humanCorrection ? { humanCorrection: input.humanCorrection } : {}),
    recordedBy: input.recordedBy,
    recordedAt: input.now,
  };
}

/**
 * What the ledger so far suggests about one pattern.
 *
 * Corrections are counted separately and reported first: a person's word is
 * not averaged with observed results.
 */
export interface PatternStanding {
  patternId: ID;
  outcomes: number;
  successes: number;
  failures: number;
  unknown: number;
  corrections: string[];
  /** Whether there is enough consistent evidence to say anything at all. */
  hasLesson: boolean;
  /** One honest sentence. Never a percentage. */
  guidance: string;
}

export function patternStanding(patternId: ID, outcomes: PatternOutcome[]): PatternStanding {
  const mine = outcomes.filter((entry) => entry.patternId === patternId);
  const successes = mine.filter((entry) => entry.result === "success").length;
  const failures = mine.filter((entry) => entry.result === "failure").length;
  const unknown = mine.filter((entry) => entry.result === "unknown").length;
  const corrections = mine
    .map((entry) => entry.humanCorrection)
    .filter((entry): entry is string => Boolean(entry));

  const hasLesson =
    successes >= PATTERN_LESSON_THRESHOLD || failures >= PATTERN_LESSON_THRESHOLD;

  let guidance: string;
  if (corrections.length > 0) {
    guidance = `A person has corrected this reading before: ${corrections[corrections.length - 1]}`;
  } else if (mine.length === 0) {
    guidance = "Nothing has come back on this reading yet.";
  } else if (!hasLesson) {
    guidance = `${mine.length} outcome${mine.length === 1 ? "" : "s"} recorded, which is not enough to change how this is read.`;
  } else if (failures >= PATTERN_LESSON_THRESHOLD) {
    guidance = "This reading has not held up the last few times it was acted on.";
  } else {
    guidance = "This reading has held up the last few times it was acted on.";
  }

  return { patternId, outcomes: mine.length, successes, failures, unknown, corrections, hasLesson, guidance };
}

/**
 * Repeated evidence may propose a change to the canon. It never applies one.
 * A single outcome always returns nothing.
 */
export function proposePatternRevision(
  patternId: ID,
  outcomes: PatternOutcome[],
): PatternRevisionProposal | null {
  const standing = patternStanding(patternId, outcomes);
  if (!standing.hasLesson && standing.corrections.length === 0) return null;
  const pattern = patternById(patternId);
  if (!pattern) return null;

  const mine = outcomes.filter((entry) => entry.patternId === patternId);
  const suggestion =
    standing.corrections.length > 0
      ? `A person has corrected this reading. Consider rewording it as: ${standing.corrections[standing.corrections.length - 1]}`
      : standing.failures >= PATTERN_LESSON_THRESHOLD
        ? "Consider lowering the confidence guidance on this pattern, or adding the competing explanation people keep choosing instead."
        : "Consider noting that this reading has held up here, without raising its confidence cap.";

  return {
    patternId,
    fromVersion: pattern.version,
    suggestion,
    outcomeRefs: mine.map((entry) => entry.id),
    requiresApproval: true,
  };
}
