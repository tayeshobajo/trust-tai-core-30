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

export interface PriorExperience {
  patternId: ID;
  /** Cases for this pattern, newest first. References only. */
  cases: IntelligenceCase[];
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
  limit?: number;
}

function newestFirst<T extends { recordedAt?: string; createdAt?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    String(b.recordedAt ?? b.createdAt ?? "").localeCompare(String(a.recordedAt ?? a.createdAt ?? "")),
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

  return {
    patternId: input.patternId,
    cases: cases.slice(0, input.limit ?? 3),
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
    });
    if (experience.cases.length > 0 || experience.standing.outcomes > 0) {
      out[match.patternId] = experience;
    }
  }
  return out;
}

/** Every pattern this organization has a record for, strongest record first. */
export function experienceLedger(input: {
  cases: IntelligenceCase[];
  outcomes: PatternOutcome[];
}): PriorExperience[] {
  const ids = new Set<string>([
    ...input.cases.map((row) => row.patternId),
    ...input.outcomes.map((row) => row.patternId),
  ]);
  return [...ids]
    .map((patternId) => priorExperience({ patternId, cases: input.cases, outcomes: input.outcomes }))
    .sort(
      (a, b) =>
        b.corrections.length - a.corrections.length ||
        b.standing.outcomes - a.standing.outcomes ||
        a.patternId.localeCompare(b.patternId),
    );
}

/** Cases with nothing recorded against them yet. */
export function openCases(cases: IntelligenceCase[], outcomes: PatternOutcome[]): IntelligenceCase[] {
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
