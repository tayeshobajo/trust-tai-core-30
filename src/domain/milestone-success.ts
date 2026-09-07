/**
 * Trust Tai OS, the human facing milestone success definition.
 *
 * Product law: **People describe success. The system structures measurement.**
 *
 * For day to day delivery a milestone needs four plain things, and nothing
 * that looks like backend plumbing:
 *
 *   Outcome        what success looks like, in a sentence.
 *   Target date    optional, and never silently today.
 *   Acceptance     the checklist, which lives in `milestone-criteria.ts`.
 *   Success check  optional, how we will know it worked.
 *
 * The structured outcome metric (P3-01) and its measurements (P3-02) are not
 * replaced by any of this. They stay exactly as they are, behind an optional
 * "Add measurable target" action, for the milestones that genuinely carry a
 * number.
 *
 * Roadmap owns this truth. It is always a person's words, so it is stored as
 * `decided` with who wrote it and when. Absence stays absence.
 */

import type { ID, ISODateTime } from "./entities";

/** What a person types. Only the outcome is required. */
export interface MilestoneSuccessInput {
  outcome: string;
  /** ISO calendar date, `YYYY-MM-DD`, or null when nobody has committed one. */
  targetDate: string | null;
  /** How we will know it worked, in the person's own words, or null. */
  successCheck: string | null;
}

export interface MilestoneSuccess extends MilestoneSuccessInput {
  tier: "decided";
  recordedBy: ID;
  recordedAt: ISODateTime;
}

export type SuccessCheckResult =
  { ok: true; success: MilestoneSuccessInput } | { ok: false; refusal: string };

export const NO_SUCCESS = "No outcome described yet";

/** Absence of a target date, said plainly, so the read state is never blank. */
export const NO_TARGET_DATE = "No target date yet";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(raw: string): boolean {
  if (!DATE_SHAPE.test(raw)) return false;
  const parsed = new Date(`${raw}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

/**
 * Fail closed on the one required fact, and stay quiet about the rest. An
 * empty target date means no target date, never today.
 */
export function checkMilestoneSuccess(raw: Partial<MilestoneSuccessInput>): SuccessCheckResult {
  const outcome = clean(raw.outcome);
  if (!outcome) {
    return {
      ok: false,
      refusal: "Describe what success looks like, for example: front facing pages approved.",
    };
  }
  if (outcome.length < 4) {
    return { ok: false, refusal: "Write the outcome as something a colleague could read." };
  }
  if (outcome.length > 280) {
    return { ok: false, refusal: "Keep the outcome to a sentence or two." };
  }

  const targetDate = clean(raw.targetDate);
  if (targetDate && !validDate(targetDate)) {
    return { ok: false, refusal: "The target date must be a real calendar date, as YYYY-MM-DD." };
  }

  const successCheck = clean(raw.successCheck);
  if (successCheck.length > 280) {
    return { ok: false, refusal: "Keep the success check short." };
  }

  return {
    ok: true,
    success: {
      outcome,
      targetDate: targetDate || null,
      successCheck: successCheck || null,
    },
  };
}

/** Read a stored jsonb value back, refusing anything that is not a whole one. */
export function readMilestoneSuccess(raw: unknown): MilestoneSuccess | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const checked = checkMilestoneSuccess({
    outcome: clean(row["outcome"]),
    targetDate: clean(row["targetDate"]) || null,
    successCheck: clean(row["successCheck"]) || null,
  });
  if (!checked.ok) return null;
  const recordedBy = clean(row["recordedBy"]);
  const recordedAt = clean(row["recordedAt"]);
  if (!recordedBy || !recordedAt) return null;
  return { ...checked.success, tier: "decided", recordedBy, recordedAt };
}

/** Two success definitions are the same fact when every stated field matches. */
export function sameSuccess(
  a: MilestoneSuccessInput | null,
  b: MilestoneSuccessInput | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.outcome === b.outcome && a.targetDate === b.targetDate && a.successCheck === b.successCheck
  );
}

/** One honest line. Absence stays absence. */
export function successSummary(success: MilestoneSuccess | null | undefined): string {
  if (!success) return NO_SUCCESS;
  return success.targetDate ? `${success.outcome} (by ${success.targetDate})` : success.outcome;
}

/** The stable key for "this outcome was written", used for dedupe. */
export function successEventKey(milestoneId: ID, success: MilestoneSuccessInput | null): string {
  if (!success) return `roadmap.outcome_cleared:${milestoneId}`;
  const shape = [
    success.outcome,
    success.targetDate ?? "none",
    success.successCheck ?? "none",
  ].join("|");
  return `roadmap.outcome_set:${milestoneId}:${shape}`;
}
