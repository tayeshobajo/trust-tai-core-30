/**
 * Trust Tai OS, Steward weekly goal proposer.
 *
 * The Captain proposes one outcome for the week from real, open Steward tasks.
 * A person confirms it. This module only proposes: it is a pure function that
 * turns the tasks a person is carrying into a draft goal, or nothing when there
 * is nothing worth proposing. It never confirms, never writes, never reads the
 * clock. The week's Monday is passed in so the same inputs always give the same
 * draft.
 *
 * This is the seam an LLM or the Conductor slots behind later: callers pass the
 * same input and read the same ProposedGoalDraft, so the deterministic body can
 * be swapped for a smarter one without changing anyone upstream.
 */

import type { StewardTask } from "./steward-accountability";
import type { WeeklyGoalRecord } from "./steward-weekly-goal";

/**
 * A week's focus, not a backlog. Eight is enough to hold the things that matter
 * this week and few enough that the goal stays honest and finishable.
 */
const MAX_LINKED = 8;

/** A draft the Captain proposes. Inert until a person confirms it. */
export interface ProposedGoalDraft {
  /** The outcome in plain, warm language. No em dashes, no flourish. */
  title: string;
  /** Real task keys, deduped and bounded. */
  linkedTaskIds: string[];
  /** Honest target: exactly how many tasks are linked. */
  targetCount: number;
  proposedBy: "captain";
}

/**
 * A manual task carries a priority; most tasks do not. We read it defensively
 * so ranking works when it is there and treats it as normal when it is not.
 */
type WithPriority = { priority?: "low" | "normal" | "high" | "urgent" };

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function priorityRankOf(task: StewardTask): number {
  const raw = (task as StewardTask & WithPriority).priority;
  const key = raw && raw in PRIORITY_RANK ? raw : "normal";
  return PRIORITY_RANK[key] ?? PRIORITY_RANK["normal"]!;
}

function dueRankOf(task: StewardTask): number {
  if (!task.dueAt) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(task.dueAt);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * Rank the rest of the pool: overdue first, then priority, then soonest due,
 * then stable by original index. Deterministic for identical inputs.
 */
function compareTasks(
  a: { task: StewardTask; index: number },
  b: { task: StewardTask; index: number },
): number {
  const overdue = Number(b.task.overdue) - Number(a.task.overdue);
  if (overdue !== 0) return overdue;
  const priority = priorityRankOf(a.task) - priorityRankOf(b.task);
  if (priority !== 0) return priority;
  const due = dueRankOf(a.task) - dueRankOf(b.task);
  if (due !== 0) return due;
  return a.index - b.index;
}

/**
 * A candidate is a task that is not complete and is either this person's or
 * unowned. When no owner is given, anything not agent-owned is fair game, so an
 * unscoped proposal still reflects real human work rather than agent work.
 */
function isCandidate(task: StewardTask, ownerUserId?: string): boolean {
  if (task.state === "complete") return false;
  if (ownerUserId) {
    return task.owner.userId === ownerUserId || task.owner.kind === "unowned";
  }
  return task.owner.kind !== "agent";
}

/**
 * Write the outcome in a person's own words. One client or project across the
 * whole set names it. Otherwise the honest count of what matters this week.
 * Deliberately plain and a little underwritten, never an ad line.
 */
function titleFor(tasks: StewardTask[]): string {
  const projects = new Set<string>();
  const companies = new Set<string>();
  for (const task of tasks) {
    if (task.projectName) projects.add(task.projectName);
    if (task.companyLabel) companies.add(task.companyLabel);
  }

  if (projects.size === 1) {
    const [only] = [...projects];
    return `Move ${only} forward this week.`;
  }
  if (companies.size === 1) {
    const [only] = [...companies];
    return `Move ${only} forward this week.`;
  }

  const count = tasks.length;
  if (count === 1) return "Finish the one thing that matters most this week.";
  return `Clear the ${count} things that matter most this week.`;
}

/**
 * Propose the week's goal from real open tasks, or null when there is nothing
 * to ground one in. Pure: no clock, no I/O. Last week's still-open linked tasks
 * roll to the front, because carrying unfinished work forward is the point.
 */
export function proposeWeeklyGoal(input: {
  tasks: StewardTask[];
  lastWeekGoal: WeeklyGoalRecord | null;
  ownerUserId?: string;
  ownerLabel?: string;
  weekStart: string;
}): ProposedGoalDraft | null {
  const { tasks, lastWeekGoal, ownerUserId } = input;

  const candidates = tasks.filter((task) => isCandidate(task, ownerUserId));
  if (candidates.length === 0) return null;

  /* Split the pool: last week's unfinished linked work first, everything else
     ranked after it. A task counts as rolled over when its key or id appears in
     last week's linked set and it is still an open candidate. */
  const rolledIds = new Set(lastWeekGoal?.linkedTaskIds ?? []);
  const rolledOver: { task: StewardTask; index: number }[] = [];
  const rest: { task: StewardTask; index: number }[] = [];
  candidates.forEach((task, index) => {
    if (rolledIds.has(task.key) || rolledIds.has(task.id)) {
      rolledOver.push({ task, index });
    } else {
      rest.push({ task, index });
    }
  });

  rest.sort(compareTasks);

  /* Dedup by key across the whole ordered set, rolled-over first. */
  const ordered: StewardTask[] = [];
  const seen = new Set<string>();
  for (const { task } of [...rolledOver, ...rest]) {
    if (seen.has(task.key)) continue;
    seen.add(task.key);
    ordered.push(task);
  }

  const linked = ordered.slice(0, MAX_LINKED);
  if (linked.length === 0) return null;

  return {
    title: titleFor(linked),
    linkedTaskIds: linked.map((task) => task.key),
    targetCount: linked.length,
    proposedBy: "captain",
  };
}
