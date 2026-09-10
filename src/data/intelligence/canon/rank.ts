/**
 * Ranking competing readings, out loud.
 *
 * When several known shapes plausibly fit the same situation, saying "here are
 * five patterns" is not help. A person wants to know which reading the current
 * evidence actually favours, what the runner up is, and what to check before
 * acting on either.
 *
 * The ranking is deterministic and inspectable. Every ranked reading carries
 * the exact feature values it was ordered by, so nothing is decided in a place
 * a person cannot look.
 *
 * Two laws are enforced here rather than left to the caller:
 *
 *   - Current evidence outranks history. Prior experience may only nudge the
 *     order inside a narrow band, and can never overturn a clear difference in
 *     what is visible today.
 *   - A person's correction outranks anything learned from outcomes. Where a
 *     correction exists, outcome derived support is ignored entirely and the
 *     reading carries a caution instead.
 */

import type { PatternMatch } from "@/domain/intelligence-canon";

import type { PriorExperience } from "./experience";

/** The most prior experience may move a reading, in either direction. */
export const HISTORY_BAND = 0.08;

export interface RankingFeatures {
  /** Share of the pattern's conditions that are present, from the matcher. */
  evidenceCoverage: number;
  /** How many distinct facts the reading stands on, capped at three. */
  evidenceBreadth: number;
  /** How recent the current state behind the reading is. */
  recency: number;
  missingEvidence: number;
  contradicting: number;
  /** Everything visible today, combined. Always outranks history. */
  currentEvidence: number;
  /** Prior cases and outcomes, bounded by `HISTORY_BAND`. */
  historyAdjustment: number;
  priorCases: number;
  humanCorrected: boolean;
}

export interface RankedHypothesis {
  patternId: string;
  patternName: string;
  claim: string;
  /** Ordering value. Inspectable through `features`. */
  rank: number;
  features: RankingFeatures;
  /** Plain sentences naming the evidence this reading stands on. */
  standsOn: string[];
  /** The single most useful thing to look at before acting. */
  checkBeforeActing: string | null;
  /** The nearest competing reading, when one exists. */
  competingWith: string | null;
  /** A caution from this organization's own record, when there is one. */
  caution: string | null;
}

export interface RankInput {
  matches: PatternMatch[];
  /** Prior experience keyed by pattern id, as `experienceForMatches` returns. */
  experience?: Record<string, PriorExperience>;
  /** When each observation was last seen, for recency. Optional. */
  observedAt?: Record<string, string>;
  now?: string;
  limit?: number;
}

const DAY = 86_400_000;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Freshest matched fact, as a 0 to 1 value. Neutral when nothing is dated. */
function recencyOf(match: PatternMatch, observedAt: Record<string, string>, now: number): number {
  const stamps = match.matched
    .map((entry) => Date.parse(observedAt[entry.observationId] ?? ""))
    .filter((value) => !Number.isNaN(value));
  if (stamps.length === 0) return 0.5;
  const days = (now - Math.max(...stamps)) / DAY;
  if (days <= 1) return 1;
  if (days >= 14) return 0;
  return clamp(1 - days / 14);
}

/**
 * What this organization's own record adds, bounded so it can never outweigh
 * what is visible today. A correction replaces outcome learning rather than
 * adding to it.
 */
export function historyAdjustment(experience: PriorExperience | undefined): number {
  if (!experience) return 0;
  if (experience.corrections.length > 0) return -HISTORY_BAND;
  const { standing } = experience;
  if (standing.hasLesson) {
    if (standing.failures > standing.successes) return -HISTORY_BAND * 0.625;
    if (standing.successes > standing.failures) return HISTORY_BAND * 0.625;
    return 0;
  }
  if (standing.outcomes > 1) {
    if (standing.failures > standing.successes) return -HISTORY_BAND * 0.25;
    if (standing.successes > standing.failures) return HISTORY_BAND * 0.25;
  }
  return 0;
}

/** Everything visible today for one reading, as a 0 to 1 value. */
export function currentEvidenceScore(
  match: PatternMatch,
  recency: number,
): { value: number; breadth: number } {
  const breadth = clamp(match.matched.length / 3);
  const missingShare = clamp(
    match.missingEvidence.length / Math.max(match.matched.length + match.missingEvidence.length, 1),
  );
  const contradictedShare = clamp(match.contradicting.length / 2);
  const value = clamp(
    match.score * 0.6 +
      breadth * 0.2 +
      recency * 0.2 -
      missingShare * 0.15 -
      contradictedShare * 0.3,
  );
  return { value, breadth };
}

/**
 * Rank the readings that plausibly fit, best supported first.
 *
 * Nothing here concludes. The output is still a set of hypotheses, ordered,
 * with the reason for the order attached.
 */
export function rankHypotheses(input: RankInput): RankedHypothesis[] {
  const now = Date.parse(input.now ?? new Date().toISOString());
  const observedAt = input.observedAt ?? {};

  const ranked = input.matches.map((match) => {
    const experience = input.experience?.[match.patternId];
    const recency = recencyOf(match, observedAt, Number.isNaN(now) ? Date.now() : now);
    const { value, breadth } = currentEvidenceScore(match, recency);
    const adjustment = historyAdjustment(experience);

    const features: RankingFeatures = {
      evidenceCoverage: round(match.score),
      evidenceBreadth: round(breadth),
      recency: round(recency),
      missingEvidence: match.missingEvidence.length,
      contradicting: match.contradicting.length,
      currentEvidence: round(value),
      historyAdjustment: round(adjustment),
      priorCases: experience?.cases.length ?? 0,
      humanCorrected: (experience?.corrections.length ?? 0) > 0,
    };

    const entry: RankedHypothesis = {
      patternId: match.patternId,
      patternName: match.patternName,
      claim: match.patternName,
      rank: round(clamp(value + adjustment)),
      features,
      standsOn: match.matched.slice(0, 3).map((fact) => fact.statement),
      checkBeforeActing:
        match.missingEvidence[0]?.inspect ??
        match.competingExplanations[0]?.distinguishedBy ??
        null,
      competingWith: match.competingExplanations[0]?.explanation ?? null,
      caution: experience?.note ?? null,
    };
    return entry;
  });

  return ranked
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.features.currentEvidence - a.features.currentEvidence ||
        a.patternId.localeCompare(b.patternId),
    )
    .slice(0, input.limit ?? 4);
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * The ranking said the way a thoughtful colleague would say it: the leading
 * reading, the runner up, why the first is better supported, and the one thing
 * worth checking first.
 */
export function narrateRanking(ranked: RankedHypothesis[]): string {
  const first = ranked[0];
  if (!first) return "Nothing in the current evidence points to a known shape.";

  const parts: string[] = [`Likely: ${lowerFirst(first.claim)}.`];
  const second = ranked[1];
  if (second) parts.push(`Also plausible: ${lowerFirst(second.claim)}.`);

  if (second) {
    const gap = round(first.features.currentEvidence - second.features.currentEvidence);
    const reasons = first.standsOn.slice(0, 2);
    if (gap > 0 && reasons.length > 0) {
      parts.push(`We have stronger evidence for the first because ${reasons.join(" and ")}`);
    } else if (gap <= 0.05) {
      parts.push("The two are close on current evidence, so treat neither as settled.");
    }
  }

  if (first.caution) parts.push(first.caution);
  if (first.checkBeforeActing)
    parts.push(`Check ${lowerFirst(first.checkBeforeActing)} before acting.`);

  return parts.join(" ");
}
