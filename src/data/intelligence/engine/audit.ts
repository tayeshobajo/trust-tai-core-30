/**
 * Stage nine, made visible: the learning audit trail.
 *
 * Every consequence the engine draws from a person's decision is derivable
 * from the append-only belief ledger, so this file derives it rather than
 * storing a second version of the truth. A person can read, in order, what
 * they decided, when, and exactly what changed in the engine because of it.
 *
 * Pure functions over beliefs. Nothing here writes, scores or ranks a person.
 */

import { DISMISSAL_SUPPRESSION_THRESHOLD } from "@/data/steward/learning";
import {
  LEARNING_OUTCOME_LABEL,
  type LearningOutcome,
  type MemoryBelief,
} from "@/domain/steward-memory";
import type { RecommendationDecision } from "@/domain/intelligence-engine";

/** The decision a person made, recovered from the outcome that was written. */
const DECISION_FOR: Record<string, RecommendationDecision> = {
  confirmed: "accepted",
  edited_then_confirmed: "edited",
  dismissed_as_context: "rejected",
  marked_waiting: "deferred",
};

export const DECISION_LABEL: Record<RecommendationDecision, string> = {
  accepted: "Accepted",
  edited: "Edited",
  deferred: "Not now",
  rejected: "Not useful",
};

/** What a single decision changed in the engine. */
export type LearningEffect =
  /** The shape is now suppressed: the engine stopped raising it. */
  | "suppressed"
  /** Counted towards suppression, one more dismissal away from it. */
  | "counting_towards_suppression"
  /** The person's wording became the decided version. */
  | "wording_adopted"
  /** The shape is favoured, so it is offered earlier when it recurs. */
  | "favoured"
  /** Recorded and waiting: the engine will raise it again later. */
  | "held_for_later";

export const LEARNING_EFFECT_LABEL: Record<LearningEffect, string> = {
  suppressed: "Stopped raising this",
  counting_towards_suppression: "One more dismissal stops this",
  wording_adopted: "Your wording is now the decided version",
  favoured: "Offered earlier when it recurs",
  held_for_later: "Held, will be raised again",
};

export interface LearningTrailEntry {
  id: string;
  /** The proposal, as it read when it was decided on. */
  headline: string;
  /** What was written to the ledger, in the person's words when they edited. */
  statement: string;
  decision: RecommendationDecision;
  outcome: LearningOutcome;
  patternKey: string;
  effect: LearningEffect;
  /** How many times this shape has been dismissed, when that is the point. */
  dismissals: number;
  decidedBy: string;
  at: string;
}

export interface LearningTrail {
  entries: LearningTrailEntry[];
  /** Shapes the engine no longer raises, and how they got there. */
  suppressed: { patternKey: string; label: string; dismissals: number }[];
  /** Shapes a person accepted before. Ordering only, never confidence. */
  favoured: { patternKey: string; label: string; acceptances: number }[];
  /** Sentences a person wrote, which inference must not contradict. */
  adopted: { statement: string; at: string; by: string }[];
  /** How many dismissals of one shape stop it being raised. */
  suppressionThreshold: number;
}

function isEngineDecision(belief: MemoryBelief): boolean {
  return (
    Boolean(belief.meta.outcome) &&
    typeof belief.meta.patternKey === "string" &&
    belief.meta.patternKey.startsWith("engine:")
  );
}

/**
 * The trail, newest first, with each entry's effect resolved against every
 * other decision about the same shape — because suppression is a count, and a
 * single dismissal is not a verdict.
 */
export function learningTrail(beliefs: MemoryBelief[]): LearningTrail {
  const rows = beliefs
    .filter(isEngineDecision)
    .slice()
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  const dismissals = new Map<string, number>();
  const acceptances = new Map<string, number>();
  const labels = new Map<string, string>();

  for (const belief of rows) {
    const key = belief.meta.patternKey as string;
    labels.set(key, belief.subjectLabel || key);
    if (belief.meta.outcome === "dismissed_as_context") {
      dismissals.set(key, (dismissals.get(key) ?? 0) + 1);
    }
    if (
      belief.meta.outcome === "confirmed" ||
      belief.meta.outcome === "edited_then_confirmed"
    ) {
      acceptances.set(key, (acceptances.get(key) ?? 0) + 1);
    }
  }

  const entries: LearningTrailEntry[] = rows.map((belief) => {
    const patternKey = belief.meta.patternKey as string;
    const outcome = belief.meta.outcome as LearningOutcome;
    const decision = DECISION_FOR[outcome] ?? "deferred";
    const dismissed = dismissals.get(patternKey) ?? 0;

    let effect: LearningEffect;
    if (decision === "rejected") {
      effect =
        dismissed >= DISMISSAL_SUPPRESSION_THRESHOLD
          ? "suppressed"
          : "counting_towards_suppression";
    } else if (decision === "edited") {
      effect = "wording_adopted";
    } else if (decision === "accepted") {
      effect = "favoured";
    } else {
      effect = "held_for_later";
    }

    return {
      id: belief.id,
      headline: belief.subjectLabel || patternKey,
      statement: belief.statement,
      decision,
      outcome,
      patternKey,
      effect,
      dismissals: dismissed,
      decidedBy: belief.recordedBy,
      at: belief.recordedAt,
    };
  });

  const suppressed = [...dismissals.entries()]
    .filter(([, count]) => count >= DISMISSAL_SUPPRESSION_THRESHOLD)
    .map(([patternKey, count]) => ({
      patternKey,
      label: labels.get(patternKey) ?? patternKey,
      dismissals: count,
    }))
    .sort((a, b) => b.dismissals - a.dismissals || a.patternKey.localeCompare(b.patternKey));

  const favoured = [...acceptances.entries()]
    .map(([patternKey, count]) => ({
      patternKey,
      label: labels.get(patternKey) ?? patternKey,
      acceptances: count,
    }))
    .sort((a, b) => b.acceptances - a.acceptances || a.patternKey.localeCompare(b.patternKey));

  const adopted = rows
    .filter((belief) => belief.meta.outcome === "edited_then_confirmed")
    .map((belief) => ({
      statement: belief.statement,
      at: belief.recordedAt,
      by: belief.recordedBy,
    }));

  return {
    entries,
    suppressed,
    favoured,
    adopted,
    suppressionThreshold: DISMISSAL_SUPPRESSION_THRESHOLD,
  };
}

/** One plain sentence about the state of learning. Honest when empty. */
export function learningSummary(trail: LearningTrail): string {
  if (trail.entries.length === 0) {
    return "You have not decided on anything yet, so the engine has learned nothing from you.";
  }
  const parts = [
    `${trail.entries.length} decision${trail.entries.length === 1 ? "" : "s"} recorded`,
  ];
  if (trail.suppressed.length > 0) {
    parts.push(
      `${trail.suppressed.length} reading${trail.suppressed.length === 1 ? " is" : "s are"} no longer raised`,
    );
  }
  if (trail.adopted.length > 0) {
    parts.push(
      `${trail.adopted.length} sentence${trail.adopted.length === 1 ? "" : "s"} you rewrote`,
    );
  }
  if (trail.favoured.length > 0) {
    parts.push(
      `${trail.favoured.length} shape${trail.favoured.length === 1 ? "" : "s"} offered earlier`,
    );
  }
  return `${parts.join(", ")}.`;
}

export { LEARNING_OUTCOME_LABEL };
