/**
 * The learning loop.
 *
 * The Conductor gets things wrong. What matters is what happens next: a
 * correction is recorded with a person's name on it, and the next answer is
 * different in a way anyone can inspect.
 *
 * Two effects, both bounded and both reversible by time:
 *
 *   - a corrected number becomes a decided figure, and decided beats inferred
 *     everywhere downstream;
 *   - a rejected suggestion goes quiet for {@link CORRECTION_SUPPRESSION_DAYS}
 *     and then may be raised again, because a thing that was not worth doing
 *     in March may be worth doing in June.
 *
 * Nothing here rewrites history, retrains a model, or changes code. The
 * corrections are the memory; this function is the only reading of them.
 */

import {
  CORRECTION_SUPPRESSION_DAYS,
  type BusinessFigure,
  type ConductorCorrection,
  type LearningState,
} from "@/domain/conductor";

const DAY = 86_400_000;

/**
 * Fold recorded corrections into the state the next answer should respect.
 *
 * Pure and deterministic: the same corrections and the same clock always
 * produce the same suppressions, in the same order.
 */
export function learningState(
  organizationId: string,
  corrections: ConductorCorrection[],
  now: string,
): LearningState {
  const mine = corrections
    .filter((row) => row.organizationId === organizationId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const nowMs = new Date(now).getTime();
  const suppressed: LearningState["suppressed"] = [];
  const seen = new Set<string>();

  for (const correction of mine) {
    if (correction.kind !== "not_useful" && correction.kind !== "already_handled") continue;
    const key = correction.subjectKey;
    if (!key || seen.has(key)) continue;
    const untilMs = Date.parse(correction.at) + CORRECTION_SUPPRESSION_DAYS * DAY;
    if (Number.isNaN(untilMs) || untilMs <= nowMs) continue;
    seen.add(key);
    suppressed.push({
      key,
      because: `${correction.correctedBy.label}: ${correction.note}`.trim(),
      until: new Date(untilMs).toISOString(),
    });
  }

  /* Newest correction per figure key wins; older ones stay in the trail. */
  const correctedFigures: BusinessFigure[] = [];
  const figureKeys = new Set<string>();
  for (const correction of mine) {
    const figure = correction.figure;
    if (correction.kind !== "wrong_figure" || !figure || figureKeys.has(figure.key)) continue;
    figureKeys.add(figure.key);
    correctedFigures.push({
      id: `correction-figure:${correction.id}`,
      organizationId,
      key: figure.key,
      value: figure.value,
      ...(figure.unit ? { unit: figure.unit } : {}),
      basis: "decided",
      asOf: figure.asOf,
      note: correction.note,
      recordedBy: correction.correctedBy,
      recordedAt: correction.at,
    });
  }

  return { organizationId, suppressed, correctedFigures, considered: mine };
}

/**
 * Recorded figures plus figures supplied by correction, corrections first.
 *
 * A person contradicting the Conductor to its face is the strongest signal
 * available, so it outranks the standing record for the same key and date.
 */
export function figuresWithCorrections(
  figures: BusinessFigure[],
  learning: LearningState,
): BusinessFigure[] {
  return [...learning.correctedFigures, ...figures];
}

/** Whether a suggestion is currently held quiet. */
export function isSuppressed(learning: LearningState, key: string): boolean {
  return learning.suppressed.some((row) => row.key === key);
}
