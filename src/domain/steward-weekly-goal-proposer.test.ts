import { describe, expect, it } from "vitest";

import { proposeWeeklyGoal } from "./steward-weekly-goal-proposer";
import type { StewardOwner, StewardTask } from "./steward-accountability";
import type { WeeklyGoalRecord } from "./steward-weekly-goal";

const OWNER = "user-1";
const WEEK = "2026-09-21";

function human(userId: string): StewardOwner {
  return { kind: "human", key: `k:${userId}`, name: "Person", initials: "P", userId };
}

const UNOWNED: StewardOwner = { kind: "unowned", key: "unowned", name: "No owner", initials: "?" };

function task(overrides: Partial<StewardTask> & { key: string }): StewardTask {
  return {
    id: overrides.id ?? overrides.key,
    origin: "manual",
    title: overrides.title ?? `Task ${overrides.key}`,
    sourceLabel: "Created here",
    owner: overrides.owner ?? human(OWNER),
    focus: "do_now",
    focusSetByHuman: false,
    state: overrides.state ?? "open",
    overdue: overrides.overdue ?? false,
    completionPath: "steward",
    evidence: [],
    why: "",
    rank: 0,
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function lastWeekGoal(linkedTaskIds: string[]): WeeklyGoalRecord {
  return {
    id: "goal-prev",
    organizationId: "org-1",
    weekStart: "2026-09-14",
    title: "Last week",
    status: "confirmed",
    linkedTaskIds,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  };
}

describe("proposeWeeklyGoal", () => {
  it("returns null when the candidate pool is empty", () => {
    const tasks = [task({ key: "a", state: "complete" })];
    expect(
      proposeWeeklyGoal({ tasks, lastWeekGoal: null, ownerUserId: OWNER, weekStart: WEEK }),
    ).toBeNull();
  });

  it("rolls last week's still-open linked task to the front", () => {
    const tasks = [
      task({ key: "fresh", overdue: true }),
      task({ key: "carried" }),
    ];
    const draft = proposeWeeklyGoal({
      tasks,
      lastWeekGoal: lastWeekGoal(["carried"]),
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft).not.toBeNull();
    expect(draft!.linkedTaskIds[0]).toBe("carried");
  });

  it("ranks overdue tasks first among the rest", () => {
    const tasks = [
      task({ key: "calm" }),
      task({ key: "late", overdue: true }),
    ];
    const draft = proposeWeeklyGoal({
      tasks,
      lastWeekGoal: null,
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft!.linkedTaskIds[0]).toBe("late");
  });

  it("dedupes duplicate keys", () => {
    const tasks = [task({ key: "dup" }), task({ key: "dup" }), task({ key: "other" })];
    const draft = proposeWeeklyGoal({
      tasks,
      lastWeekGoal: null,
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft!.linkedTaskIds).toEqual(["dup", "other"]);
  });

  it("caps the linked set at 8", () => {
    const tasks = Array.from({ length: 12 }, (_v, i) => task({ key: `t${i}` }));
    const draft = proposeWeeklyGoal({
      tasks,
      lastWeekGoal: null,
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft!.linkedTaskIds).toHaveLength(8);
  });

  it("keeps targetCount equal to the linked set length", () => {
    const tasks = [task({ key: "a" }), task({ key: "b" }), task({ key: "c" })];
    const draft = proposeWeeklyGoal({
      tasks,
      lastWeekGoal: null,
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft!.targetCount).toBe(draft!.linkedTaskIds.length);
    expect(draft!.targetCount).toBe(3);
  });

  it("marks the draft proposed by the captain", () => {
    const draft = proposeWeeklyGoal({
      tasks: [task({ key: "a" })],
      lastWeekGoal: null,
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft!.proposedBy).toBe("captain");
  });

  it("writes a non-empty title with no em dash", () => {
    const draft = proposeWeeklyGoal({
      tasks: [task({ key: "a" }), task({ key: "b" })],
      lastWeekGoal: null,
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft!.title.length).toBeGreaterThan(0);
    expect(draft!.title).not.toContain("\u2014");
  });

  it("includes unowned tasks and excludes agent-owned when scoped to a person", () => {
    const tasks = [
      task({ key: "mine" }),
      task({ key: "free", owner: UNOWNED }),
      task({ key: "agent", owner: { kind: "agent", key: "bot", name: "Bot", initials: "B" } }),
    ];
    const draft = proposeWeeklyGoal({
      tasks,
      lastWeekGoal: null,
      ownerUserId: OWNER,
      weekStart: WEEK,
    });
    expect(draft!.linkedTaskIds).toContain("mine");
    expect(draft!.linkedTaskIds).toContain("free");
    expect(draft!.linkedTaskIds).not.toContain("agent");
  });
});
