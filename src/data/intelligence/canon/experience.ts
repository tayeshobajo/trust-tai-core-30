/**
 * Prior experience, kept apart from current evidence.
 *
 * When a shape is recognised again, the organization's own record of what
 * happened last time is worth saying out loud. It is never worth treating as
 * evidence about today, so it travels in its own lane with its own words.
 *
 * Laws applied here rather than left to the caller:
 *   - One case is anecdote. Nothing is offered as guidance from a single result.
 *   - A person's correction outranks anything inferred, and is said first.
 *   - Nothing raises a pattern's confidence. Experience only adds a caution.
 */

import type { ID } from "@/domain/entities";
import {
  PATTERN_LESSON_THRESHOLD,
  type IntelligenceCase,
  type PatternMatch,
  type PatternOutcome,
  type PatternRevisionProposal,
} from "@/domain/intelligence-canon";

import { patternStanding, proposePatternRevision, type PatternStanding } from "./cases";

/**
 * How closely a prior case resembles the situation in front of us.
 *
 * The point is to stop a weak analogy being read as strong precedent. A case
 * that matched the same pattern on entirely different evidence is worth far
 * less than one that stood on the same facts, and a case a person corrected is
 * worth more than either.
 */
export type CaseAnalogy = "same_shape" | "different_shape" | "human_corrected";

/** Wording for a surface. Deliberately plain, no internal vocabulary. */
export const CASE_ANALOGY_LABEL: Record<CaseAnalogy, string> = {
  same_shape: "Closely similar situation",
  different_shape: "Loosely similar situation",
  human_corrected: "You corrected this reading before",
};

export interface PriorCase {
  entry: IntelligenceCase;
  analogy: CaseAnalogy;
  /** Whether this case is worth leaning on at all. */
  strongPrecedent: boolean;
}

export interface PriorExperience {
  patternId: ID;
  /** Cases for this pattern, newest first. References only. */
  cases: IntelligenceCase[];
  /** The same cases, with how close the resemblance actually is. */
  priorCases: PriorCase[];
  /** Corrections a person wrote, newest first. Human authored truth. */
  corrections: string[];
  standing: PatternStanding;
  proposal: PatternRevisionProposal | null;
  /**
   * One sentence a surface may show beside the reading, or nothing when the
   * record is too thin to say anything honest.
   */
  note: string | null;
}

export interface ExperienceInput {
  patternId: ID;
  cases: IntelligenceCase[];
  outcomes: PatternOutcome[];
  /**
   * The observation kinds the current reading stands on. Without it no case
   * can claim a close resemblance, which is the honest default.
   */
  shapeKinds?: string[];
  limit?: number;
}

/** Observation ids carry their kind, as `obs:<kind>:<subject>`. */
function kindsOfCase(entry: IntelligenceCase): string[] {
  return entry.evidenceRefs
    .filter((ref) => ref.kind === "observation")
    .map((ref) => ref.id.split(":")[1] ?? "")
    .filter((kind) => kind.length > 0);
}

/** How close one prior case really is to the shape in front of us. */
export function classifyPriorCase(entry: IntelligenceCase, shapeKinds: string[]): PriorCase {
  if (entry.correction && entry.correction.trim().length > 0) {
    return { entry, analogy: "human_corrected", strongPrecedent: true };
  }
  if (shapeKinds.length === 0) {
    return { entry, analogy: "different_shape", strongPrecedent: false };
  }
  const kinds = new Set(kindsOfCase(entry));
  const shared = shapeKinds.filter((kind) => kinds.has(kind)).length;
  const same = shared > 0 && shared >= Math.ceil(shapeKinds.length / 2);
  return {
    entry,
    analogy: same ? "same_shape" : "different_shape",
    strongPrecedent: same,
  };
}

function newestFirst<T extends { recordedAt?: string; createdAt?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    String(b.recordedAt ?? b.createdAt ?? "").localeCompare(
      String(a.recordedAt ?? a.createdAt ?? ""),
    ),
  );
}

/** What this organization already learned about one pattern. */
export function priorExperience(input: ExperienceInput): PriorExperience {
  const cases = newestFirst(input.cases.filter((row) => row.patternId === input.patternId));
  const outcomes = newestFirst(input.outcomes.filter((row) => row.patternId === input.patternId));
  const standing = patternStanding(input.patternId, outcomes);

  /* Corrections come from both ledgers: the case a person rewrote, and the
   * outcome they annotated. Either way the words are theirs. */
  const corrections = [
    ...outcomes.map((row) => row.humanCorrection),
    ...cases.map((row) => row.correction),
  ].filter((entry): entry is string => Boolean(entry && entry.trim().length > 0));

  let note: string | null = null;
  if (corrections[0]) {
    note = `A similar case here was later corrected: ${corrections[0]} Check that before treating this reading as settled.`;
  } else if (standing.failures >= PATTERN_LESSON_THRESHOLD) {
    note = "This reading has not held up the last few times it was acted on here.";
  } else if (standing.successes >= PATTERN_LESSON_THRESHOLD) {
    note = "This reading has held up the last few times it was acted on here.";
  }

  const shown = cases.slice(0, input.limit ?? 3);

  return {
    patternId: input.patternId,
    cases: shown,
    priorCases: shown.map((entry) => classifyPriorCase(entry, input.shapeKinds ?? [])),
    corrections,
    standing,
    proposal: proposePatternRevision(input.patternId, outcomes),
    note,
  };
}

/** Prior experience for each surfaced match, keyed by pattern id. */
export function experienceForMatches(input: {
  matches: PatternMatch[];
  cases: IntelligenceCase[];
  outcomes: PatternOutcome[];
}): Record<string, PriorExperience> {
  const out: Record<string, PriorExperience> = {};
  for (const match of input.matches) {
    const experience = priorExperience({
      patternId: match.patternId,
      cases: input.cases,
      outcomes: input.outcomes,
      shapeKinds: match.matched.map((fact) => fact.observationKind),
    });
    if (experience.cases.length > 0 || experience.standing.outcomes > 0) {
      out[match.patternId] = experience;
    }
  }
  return out;
}

/**
 * Every pattern this organization has a record for, in the order a person
 * should read them:
 *
 *   1. patterns a person corrected, because their word outranks inference
 *   2. patterns with repeated consistent outcomes, because that is a lesson
 *   3. the most recently resolved records
 *   4. single anecdotes last
 *
 * Ordering is retrieval only. Nothing here raises confidence, and none of it
 * is evidence about today.
 */
export function experienceLedger(input: {
  cases: IntelligenceCase[];
  outcomes: PatternOutcome[];
}): PriorExperience[] {
  const ids = new Set<string>([
    ...input.cases.map((row) => row.patternId),
    ...input.outcomes.map((row) => row.patternId),
  ]);

  const lastResolvedAt = (patternId: string): string =>
    input.outcomes
      .filter((row) => row.patternId === patternId)
      .map((row) => row.recordedAt)
      .sort()
      .reverse()[0] ?? "";

  const rank = (row: PriorExperience): number => {
    if (row.corrections.length > 0) return 0;
    if (row.standing.hasLesson) return 1;
    if (row.standing.outcomes > 1) return 2;
    return 3;
  };

  return [...ids]
    .map((patternId) =>
      priorExperience({ patternId, cases: input.cases, outcomes: input.outcomes }),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.standing.outcomes - a.standing.outcomes ||
        lastResolvedAt(b.patternId).localeCompare(lastResolvedAt(a.patternId)) ||
        a.patternId.localeCompare(b.patternId),
    );
}

/** Cases with nothing recorded against them yet. */
export function openCases(
  cases: IntelligenceCase[],
  outcomes: PatternOutcome[],
): IntelligenceCase[] {
  const closed = new Set(outcomes.map((row) => row.caseId).filter(Boolean));
  return newestFirst(cases.filter((row) => !closed.has(row.id)));
}

/** Cases an outcome has already been written for. */
export function resolvedCases(
  cases: IntelligenceCase[],
  outcomes: PatternOutcome[],
): { entry: IntelligenceCase; outcome: PatternOutcome }[] {
  const byCase = new Map<string, PatternOutcome>();
  for (const outcome of newestFirst(outcomes)) {
    if (outcome.caseId && !byCase.has(outcome.caseId)) byCase.set(outcome.caseId, outcome);
  }
  return newestFirst(cases)
    .filter((entry) => byCase.has(entry.id))
    .map((entry) => ({ entry, outcome: byCase.get(entry.id)! }));
}
