/**
 * Stage nine: learn.
 *
 * A decision about a recommendation is feedback about the business, so it is
 * written where every other piece of learned truth already lives: the
 * append-only belief ledger. No new table, no scores, no hidden weighting —
 * only a countable record of what a person explicitly decided, and a small,
 * legible set of consequences:
 *
 *   - rejected twice  → the engine stops raising that shape of reading
 *   - edited          → the person's wording becomes the decided version
 *   - accepted        → the engine watches the signal it said would move
 */

import {
  DISMISSAL_SUPPRESSION_THRESHOLD,
  outcomeRecordsFromBeliefs,
  outcomeToDraft,
  suppressedPatterns,
} from "@/data/steward/learning";
import type { LearningOutcome, MemoryBelief, MemoryDraft } from "@/domain/steward-memory";
import type {
  Observation,
  Recommendation,
  RecommendationDecision,
} from "@/domain/intelligence-engine";

const OUTCOME_FOR: Record<RecommendationDecision, LearningOutcome> = {
  accepted: "confirmed",
  edited: "edited_then_confirmed",
  rejected: "dismissed_as_context",
  deferred: "marked_waiting",
};

/** The subject key engine feedback is filed under. */
export function engineSubject(patternKey: string): string {
  return `engine:${patternKey.replace(/^engine:/, "")}`;
}

/**
 * What gets written when a person decides about a recommendation. It is a
 * decided, human-authority row: the engine proposed, a person answered.
 */
export function recommendationOutcomeDraft(input: {
  recommendation: Recommendation;
  decision: RecommendationDecision;
  editedText?: string;
  note?: string;
}): MemoryDraft {
  const { recommendation, decision } = input;
  const about =
    decision === "edited" && input.editedText?.trim()
      ? input.editedText.trim()
      : recommendation.headline;

  return outcomeToDraft({
    outcome: OUTCOME_FOR[decision],
    subjectKey: engineSubject(recommendation.patternKey),
    subjectLabel: recommendation.headline,
    about,
    patternKey: recommendation.patternKey,
    evidence: [
      {
        kind: "computed",
        label: `Proposed by the Intelligence Engine — expected to change: ${recommendation.expectedSignal}`,
      },
    ],
    ...(input.note ? { note: input.note } : {}),
  });
}

/** Feedback about engine proposals, separated from feedback about people. */
export function engineOutcomeRecords(beliefs: MemoryBelief[]) {
  return outcomeRecordsFromBeliefs(beliefs).filter((record) =>
    record.patternKey.startsWith("engine:"),
  );
}

/** Shapes of reading a person has told the engine to stop raising. */
export function enginePatternsToSuppress(beliefs: MemoryBelief[]): string[] {
  return suppressedPatterns(engineOutcomeRecords(beliefs), DISMISSAL_SUPPRESSION_THRESHOLD);
}

/** Shapes a person accepted before. Ordering only — never a confidence boost. */
export function engineFavouredPatterns(beliefs: MemoryBelief[]): string[] {
  return [
    ...new Set(
      engineOutcomeRecords(beliefs)
        .filter(
          (record) =>
            record.outcome === "confirmed" || record.outcome === "edited_then_confirmed",
        )
        .map((record) => record.patternKey),
    ),
  ];
}

/** Statements a person decided, which any inference must not contradict. */
export function decidedStatements(beliefs: MemoryBelief[], limit = 20): string[] {
  return beliefs
    .filter((belief) => belief.tier === "decided" && belief.authority === "human")
    .filter((belief) => !belief.meta.retired)
    .slice(0, limit)
    .map((belief) => belief.statement);
}

/* ---------------------------------------------------------------- outcomes */

export type ObservedMovement = "signal_improved" | "no_change" | "worsened" | "unknown";

/**
 * Did the thing the recommendation said would move, move?
 *
 * Compared against the observation kind the recommendation named, and only
 * that one. An accepted proposal that changed nothing is recorded as changing
 * nothing; that is the whole point of asking.
 */
export function readMovement(input: {
  recommendation: Pick<Recommendation, "expectedSignalKind">;
  before: Observation[];
  after: Observation[];
}): ObservedMovement {
  const kind = input.recommendation.expectedSignalKind;
  const magnitudeOf = (rows: Observation[]): number | undefined => {
    const matching = rows.filter((row) => row.kind === kind);
    if (matching.length === 0) return undefined;
    return matching.reduce((total, row) => total + (row.magnitude ?? 1), 0);
  };

  const before = magnitudeOf(input.before);
  const after = magnitudeOf(input.after);
  if (before === undefined) return "unknown";
  /* The reading stopped being true at all: the friction is gone. */
  if (after === undefined) return "signal_improved";
  if (after < before) return "signal_improved";
  if (after > before) return "worsened";
  return "no_change";
}
