import { describe, expect, it } from "vitest";

import { computeWeeklyGoalProgress, type WeeklyGoalRecord } from "./steward-weekly-goal";
import type { StewardOwner, StewardTask } from "./steward-accountability";

const NOW = "2026-09-21T09:00:00.000Z";

function owner(kind: StewardOwner["kind"]): StewardOwner {
  return { kind, key: kind === "agent" ? "agent-1" : "ada@trusttai.com", name: "Owner", initials: "O" };
}

function task(overrides: Partial<StewardTask> & { key: string }): StewardTask {
  return {
    id: overrides.id ?? overrides.key,
    origin: "manual",
    title: "A task",
    sourceLabel: "Steward",
    owner: owner("human"),
    focus: "do_now",
    focusSetByHuman: false,
    state: "open",
    overdue: false,
    completionPath: "steward",
    evidence: [],
    why: "",
    rank: 0,
    updatedAt: NOW,
    ...overrides,
  } as StewardTask;
}

function goal(linkedTaskIds: string[]): WeeklyGoalRecord {
  return {
    id: "goal-1",
    organizationId: "org",
    weekStart: "2026-09-21",
    title: "Clear the backlog",
    status: "confirmed",
    linkedTaskIds,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("computeWeeklyGoalProgress", () => {
  it("reports zeroes when nothing is linked", () => {
    const progress = computeWeeklyGoalProgress(goal([]), []);
    expect(progress).toEqual({
      linkedTotal: 0,
      linkedComplete: 0,
      agentCleared: 0,
      humanRemaining: 0,
      pct: 0,
    });
  });

  it("counts some complete and rounds the percentage honestly", () => {
    const tasks = [
      task({ key: "a", state: "complete" }),
      task({ key: "b", state: "open" }),
      task({ key: "c", state: "open" }),
    ];
    const progress = computeWeeklyGoalProgress(goal(["a", "b", "c"]), tasks);
    expect(progress.linkedTotal).toBe(3);
    expect(progress.linkedComplete).toBe(1);
    expect(progress.humanRemaining).toBe(2);
    expect(progress.pct).toBe(33);
  });

  it("counts only complete agent-owned tasks as cleared for you", () => {
    const tasks = [
      task({ key: "a", state: "complete", owner: owner("agent") }),
      task({ key: "b", state: "complete", owner: owner("human") }),
      task({ key: "c", state: "open", owner: owner("agent") }),
    ];
    const progress = computeWeeklyGoalProgress(goal(["a", "b", "c"]), tasks);
    expect(progress.linkedComplete).toBe(2);
    expect(progress.agentCleared).toBe(1);
    // The open agent task is not human work, so it never counts as human remaining.
    expect(progress.humanRemaining).toBe(0);
  });

  it("excludes a missing linked id from both total and complete", () => {
    const tasks = [task({ key: "a", state: "complete" })];
    const progress = computeWeeklyGoalProgress(goal(["a", "ghost"]), tasks);
    expect(progress.linkedTotal).toBe(1);
    expect(progress.linkedComplete).toBe(1);
    expect(progress.pct).toBe(100);
  });
});
