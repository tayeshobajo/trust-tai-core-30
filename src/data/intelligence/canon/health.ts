/**
 * Weekly experience health.
 *
 * One honest question: is the organization actually accumulating experience,
 * or does the ledger only look busy? Counts are read from the ledger itself,
 * never from room state, and nothing here scores a person.
 */

import {
  PATTERN_LESSON_THRESHOLD,
  type ExperienceHealth,
  type IntelligenceCase,
  type PatternOutcome,
  type PatternRevisionDecision,
} from "@/domain/intelligence-canon";

import { openCases } from "./experience";
import { awaitingDecision, proposalFingerprint } from "./proposals";
import { proposePatternRevision } from "./cases";

const DAY = 86_400_000;
export const HEALTH_WINDOW_DAYS = 7;

export interface HealthInput {
  cases: IntelligenceCase[];
  outcomes: PatternOutcome[];
  decisions: PatternRevisionDecision[];
  now: string;
}

/** The last seven days of the ledger, plus the age of the oldest open case. */
export function experienceHealth(input: HealthInput): ExperienceHealth {
  const nowMs = Date.parse(input.now);
  const sinceMs = nowMs - HEALTH_WINDOW_DAYS * DAY;
  const since = new Date(sinceMs).toISOString();

  const within = (at: string): boolean => {
    const ms = Date.parse(at);
    return !Number.isNaN(ms) && ms >= sinceMs;
  };

  const casesOpened = input.cases.filter((row) => within(row.decidedAt)).length;
  const recentOutcomes = input.outcomes.filter((row) => within(row.recordedAt));
  const casesResolved = new Set(
    recentOutcomes.map((row) => row.caseId).filter((id): id is string => Boolean(id)),
  ).size;
  const corrections =
    recentOutcomes.filter((row) => Boolean(row.humanCorrection?.trim())).length +
    input.cases.filter((row) => within(row.decidedAt) && Boolean(row.correction?.trim())).length;

  const byPattern = new Map<string, number>();
  for (const outcome of input.outcomes) {
    byPattern.set(outcome.patternId, (byPattern.get(outcome.patternId) ?? 0) + 1);
  }
  const patternsWithEnoughOutcomes = [...byPattern.values()].filter(
    (count) => count >= PATTERN_LESSON_THRESHOLD,
  ).length;

  const seen = new Set<string>();
  let proposalsAwaitingDecision = 0;
  for (const patternId of byPattern.keys()) {
    const proposal = proposePatternRevision(patternId, input.outcomes);
    if (!proposal) continue;
    const fingerprint = proposalFingerprint(proposal);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    if (awaitingDecision(proposal, input.decisions)) proposalsAwaitingDecision += 1;
  }

  const stillOpen = openCases(input.cases, input.outcomes);
  const oldest = stillOpen
    .map((row) => Date.parse(row.decidedAt))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b)[0];

  /* Automatic work, counted from the ledger only. A case still open but
   * checkable stayed unknown, which is an honest answer rather than a miss. */
  const resolvedAutomatically = new Set(
    recentOutcomes
      .filter((row) => row.resultSource === "room_event" || row.resultSource === "current_state")
      .map((row) => row.caseId)
      .filter((id): id is string => Boolean(id)),
  );
  const unknownAfterChecks = stillOpen.filter((row) => canReconcile(row.patternId)).length;

  return {
    since,
    casesOpened,
    casesResolved,
    corrections,
    patternsWithEnoughOutcomes,
    proposalsAwaitingDecision,
    oldestOpenCaseDays: oldest === undefined ? null : Math.max(0, Math.floor((nowMs - oldest) / DAY)),
    casesCheckedAutomatically: resolvedAutomatically.size + unknownAfterChecks,
    casesResolvedAutomatically: resolvedAutomatically.size,
    casesUnknownAfterChecks: unknownAfterChecks,
  };
}
