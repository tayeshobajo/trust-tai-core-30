/**
 * Trust Tai OS, manual milestone creation (Roadmap).
 *
 * Product law: generation is assistance, never the only doorway. A person who
 * already knows the milestone must be able to state it in their own words and
 * have it land as Decided truth, with their name and the time on it.
 *
 * What this file does NOT do: invent fields. The canonical store requires only
 * a name. Everything else a research pass would fill in stays honestly empty
 * rather than being guessed on a person's behalf.
 */

import type { ID } from "./entities";

/** The smallest honest thing a person can say about a milestone. */
export interface ManualMilestoneInput {
  /** What the milestone is, in the person's own words. Required. */
  name: string;
  /** The asset or capability this actually builds. Optional, never guessed. */
  whatWeBuild?: string;
  /** Where the work stops. Optional, never guessed. */
  executionBoundary?: string;
}

export interface ManualMilestone {
  name: string;
  whatWeBuild: string;
  executionBoundary: string;
}

export type ManualMilestoneCheck =
  { ok: true; milestone: ManualMilestone } | { ok: false; refusal: string };

export const MIN_MILESTONE_NAME = 4;
export const MAX_MILESTONE_NAME = 160;

/** Why a manual milestone carries no research score. Stated, not implied. */
export const MANUAL_PRIORITY_RATIONALE = ["Created by a person, not ranked by a research pass."];

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** A name comparison that ignores spacing and case, so a double submit is caught. */
export function normalizeMilestoneName(name: string): string {
  return clean(name).toLowerCase();
}

/**
 * Fail closed. A milestone without a name is not a milestone, and no default
 * name is ever supplied.
 */
export function checkManualMilestone(input: Partial<ManualMilestoneInput>): ManualMilestoneCheck {
  const name = clean(input.name);
  if (!name) {
    return { ok: false, refusal: "Give the milestone a name before saving it." };
  }
  if (name.length < MIN_MILESTONE_NAME) {
    return {
      ok: false,
      refusal: `The milestone name is too short to mean anything. Use at least ${MIN_MILESTONE_NAME} characters.`,
    };
  }
  if (name.length > MAX_MILESTONE_NAME) {
    return {
      ok: false,
      refusal: `Keep the milestone name under ${MAX_MILESTONE_NAME} characters. Detail belongs in what it builds.`,
    };
  }
  return {
    ok: true,
    milestone: {
      name,
      whatWeBuild: clean(input.whatWeBuild),
      executionBoundary: clean(input.executionBoundary),
    },
  };
}

/** Replay key, so pressing save twice records one event, not two. */
export function manualMilestoneKey(roadmapId: ID, name: string): string {
  return `roadmap.milestone_created:${roadmapId}:${normalizeMilestoneName(name)}`;
}

/** The next sequence number after everything already on the roadmap. */
export function nextSequence(existing: { recommendedSequence: number }[]): number {
  return existing.reduce((top, entry) => Math.max(top, entry.recommendedSequence), 0) + 1;
}

/** A milestone with the same name already exists on this roadmap. */
export function findSameName<T extends { name: string }>(
  existing: T[],
  name: string,
): T | undefined {
  const key = normalizeMilestoneName(name);
  return existing.find((entry) => normalizeMilestoneName(entry.name) === key);
}
