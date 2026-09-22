/**
 * Trust Tai OS, Steward weekly goal contracts.
 *
 * A weekly goal is one outcome the Captain proposes and a person confirms,
 * with a set of Steward tasks linked to it. Progress is completed linked tasks
 * over total linked tasks. The agent-cleared subset is counted separately so
 * "N cleared for you this week" is a true number, taken from real task state
 * and never invented.
 */

import type { ID, ISODateTime } from "./entities";
import type { StewardTask } from "./steward-accountability";

/* ----------------------------------------------------------------- status */

/**
 * A goal is inert until confirmed. It lands 'proposed'; only a person
 * confirming it flips it to 'confirmed'. 'complete' and 'archived' close it.
 */
export type WeeklyGoalStatus = "proposed" | "confirmed" | "complete" | "archived";

export const WEEKLY_GOAL_STATUS_LABEL: Record<WeeklyGoalStatus, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  complete: "Complete",
  archived: "Archived",
};

/* ------------------------------------------------------------------ record */

/** A weekly goal row, camelCase, matching public.steward_weekly_goals. */
export interface WeeklyGoalRecord {
  id: ID;
  organizationId: ID;
  ownerUserId?: ID;
  ownerLabel?: string;
  /** Monday of the week, as an ISO date (YYYY-MM-DD). */
  weekStart: string;
  title: string;
  status: WeeklyGoalStatus;
  /** Steward task keys or ids linked to this goal. */
  linkedTaskIds: string[];
  targetCount?: number;
  proposedBy?: string;
  confirmedAt?: ISODateTime;
  completedAt?: ISODateTime;
  notes?: string;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* --------------------------------------------------------------- progress */

export interface WeeklyGoalProgress {
  /** Linked tasks that were actually found in the read. */
  linkedTotal: number;
  /** Found linked tasks that are complete. */
  linkedComplete: number;
  /** Found, complete, agent-owned linked tasks. The honest "cleared for you". */
  agentCleared: number;
  /** Found, not complete, not agent-owned. Still on a person to finish. */
  humanRemaining: number;
  /** linkedComplete / linkedTotal as a rounded integer 0..100. */
  pct: number;
}

/**
 * Compute weekly goal progress from real task state only. Pure.
 *
 * A linked id counts only when the task is actually present in `tasks`. A
 * missing linked id is excluded from BOTH total and complete: we never assume
 * a task we cannot see is either done or pending, so no number is invented.
 * When nothing is linked or found, pct is 0.
 *
 * Completion reuses Steward's own notion: state === 'complete'. agentCleared
 * counts only complete AND owner.kind === 'agent'. humanRemaining counts tasks
 * that are not complete and not agent-owned.
 */
export function computeWeeklyGoalProgress(
  goal: WeeklyGoalRecord,
  tasks: StewardTask[],
): WeeklyGoalProgress {
  const byKey = new Map<string, StewardTask>();
  for (const task of tasks) {
    byKey.set(task.key, task);
    byKey.set(task.id, task);
  }

  let linkedTotal = 0;
  let linkedComplete = 0;
  let agentCleared = 0;
  let humanRemaining = 0;

  for (const linkedId of goal.linkedTaskIds) {
    const task = byKey.get(linkedId);
    if (!task) continue; // missing: excluded from both, never assumed.
    linkedTotal += 1;
    const complete = task.state === "complete";
    if (complete) {
      linkedComplete += 1;
      if (task.owner.kind === "agent") agentCleared += 1;
    } else if (task.owner.kind !== "agent") {
      humanRemaining += 1;
    }
  }

  const pct = linkedTotal > 0 ? Math.round((linkedComplete / linkedTotal) * 100) : 0;

  return { linkedTotal, linkedComplete, agentCleared, humanRemaining, pct };
}
