/**
 * The prior-case retrieval seam.
 *
 * "Have we solved something like this before?" answered honestly: the only
 * legitimate linkage is a shared canon pattern, a case attaches to the
 * pattern it was recorded against, and an outcome attaches to its case. This
 * module never invents similarity and never invents success: a case with no
 * outcome is "we have seen this shape before", and a rejected outcome is
 * surfaced exactly as that.
 *
 * Pure: the caller assembles cases and outcomes under RLS; this decides what
 * the reasoning stage may cite.
 */

import type {
  IntelligenceCase,
  PatternMatch,
  PatternOutcome,
} from "@/domain/intelligence-canon";

export interface PriorCaseRef {
  caseId: string;
  patternId: string;
  patternName: string;
  hypothesis: string;
  humanDecision: string;
  /** Human corrections always surface ahead of everything else. */
  correction: string | null;
  lesson: string | null;
  outcome: {
    decision: PatternOutcome["decision"];
    result: PatternOutcome["result"];
    because: string;
  } | null;
}

/**
 * Prior cases for the patterns the current evidence matches. Corrections
 * sort first within each pattern; the limit keeps the bundle small.
 */
export function priorCasesForMatches(input: {
  matches: PatternMatch[];
  cases: IntelligenceCase[];
  outcomes: PatternOutcome[];
  limit?: number;
}): PriorCaseRef[] {
  const limit = input.limit ?? 3;
  const refs: PriorCaseRef[] = [];
  for (const match of input.matches) {
    const related = input.cases
.filter((entry) => entry.patternId === match.patternId)
.sort((a, b) => Number(Boolean(b.correction)) - Number(Boolean(a.correction)));
    for (const entry of related) {
      const outcome = input.outcomes.find((row) => row.caseId === entry.id) ?? null;
      refs.push({
        caseId: entry.id,
        patternId: match.patternId,
        patternName: match.patternName,
        hypothesis: entry.hypothesis,
        humanDecision: entry.humanDecision,
        correction: entry.correction ?? null,
        lesson: entry.lesson ?? null,
        outcome: outcome
          ? {
              decision: outcome.decision,
              result: outcome.result,
              because: outcome.resultBecause,
            }
: null,
      });
      if (refs.length >= limit) return refs;
    }
  }
  return refs;
}
