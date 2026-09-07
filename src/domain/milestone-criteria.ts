/**
 * Trust Tai OS, milestone acceptance criteria.
 *
 * The concrete conditions that must be true before a milestone can be called
 * complete. A checklist, deliberately simple, so a delivery team keeps the same
 * standard across many projects without filling in analytics.
 *
 * The laws that hold here:
 *
 *  1. Roadmap owns acceptance criteria, the way it owns the milestone, its
 *     metric and its measurements. The Project workroom operates them through
 *     the same Roadmap service (Canon 17). There is no second store.
 *  2. These are not generic work items. They are the standard for one
 *     milestone, so they are not folded into Projects delivery items.
 *  3. Checking every box is evidence, never a decision. Nothing here completes
 *     a milestone; a person still does that.
 *  4. Absence is absence. No criteria reads as no criteria, never as met.
 */

import type { ID, ISODateTime } from "./entities";

export interface AcceptanceCriterion {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  milestoneId: ID;
  /** The condition, in the person's own words. */
  text: string;
  /** Order in the checklist. Ties fall back to when it was written. */
  position: number;
  done: boolean;
  createdBy: ID;
  createdAt: ISODateTime;
  completedBy?: ID | undefined;
  completedAt?: ISODateTime | undefined;
  updatedAt: ISODateTime;
}

export type CriterionCheck = { ok: true; text: string } | { ok: false; refusal: string };

export const NO_CRITERIA = "No acceptance criteria yet";

export const ACCEPTANCE_MET = "Acceptance criteria met";

/** Checking a criterion is not completing a milestone, and never will be. */
export const ACCEPTANCE_IS_EVIDENCE =
  "Every condition is checked. Completing the milestone is still a person's call.";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Fail closed before the database is touched. */
export function checkCriterionText(raw: unknown): CriterionCheck {
  const text = clean(raw);
  if (!text) {
    return { ok: false, refusal: "Write the condition, for example: home page approved." };
  }
  if (text.length < 3) {
    return { ok: false, refusal: "Write the condition as something a colleague could check." };
  }
  if (text.length > 200) {
    return { ok: false, refusal: "Keep each condition to one short line." };
  }
  return { ok: true, text };
}

/** Two conditions on one milestone should not say the same thing twice. */
export function findSameCriterion(
  rows: AcceptanceCriterion[],
  text: string,
): AcceptanceCriterion | null {
  const wanted = clean(text).toLowerCase();
  return rows.find((row) => row.text.toLowerCase() === wanted) ?? null;
}

/** Stable order: position, then when it was written, then id. */
export function sortCriteria(rows: AcceptanceCriterion[]): AcceptanceCriterion[] {
  return [...rows].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

export function nextCriterionPosition(rows: AcceptanceCriterion[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.position), 0) + 1;
}

/**
 * How the checklist stands. `met` is only true when there is something to meet,
 * so an empty checklist never reads as satisfied.
 */
export function criteriaProgress(rows: AcceptanceCriterion[]): {
  done: number;
  total: number;
  met: boolean;
} {
  const total = rows.length;
  const done = rows.filter((row) => row.done).length;
  return { done, total, met: total > 0 && done === total };
}

/** One honest line for the checklist. */
export function criteriaSummary(rows: AcceptanceCriterion[]): string {
  const { done, total, met } = criteriaProgress(rows);
  if (total === 0) return NO_CRITERIA;
  return met ? ACCEPTANCE_MET : `${done} of ${total} conditions met`;
}

/**
 * A checked condition is evidence somebody accepted something, so it is not
 * quietly deleted. Uncheck it first, then remove it.
 */
export function canRemoveCriterion(row: AcceptanceCriterion): CriterionCheck {
  if (row.done) {
    return {
      ok: false,
      refusal: "Uncheck this condition before removing it, so nothing accepted disappears quietly.",
    };
  }
  return { ok: true, text: row.text };
}

/** Positions after a person moves one condition up or down, gaps closed. */
export function reorderCriteria(
  rows: AcceptanceCriterion[],
  id: ID,
  direction: "up" | "down",
): { id: ID; position: number }[] {
  const ordered = sortCriteria(rows);
  const index = ordered.findIndex((row) => row.id === id);
  if (index === -1) return [];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return [];
  const moved = [...ordered];
  const a = moved[index]!;
  const b = moved[target]!;
  moved[index] = b;
  moved[target] = a;
  return moved
    .map((row, spot) => ({ id: row.id, position: spot + 1 }))
    .filter((entry, spot) => entry.position !== ordered[spot]!.position || entry.id !== ordered[spot]!.id);
}

/** The stable key for one written condition, used for replay protection. */
export function criterionEventKey(milestoneId: ID, text: string): string {
  return `roadmap.criterion_added:${milestoneId}:${clean(text).toLowerCase()}`;
}
