import { describe, expect, it } from "vitest";

import {
  computeMinutesSaved,
  computeStreakDays,
  computeTasksCompleted,
  computeXp,
  levelForXp,
  xpForEvent,
} from "./steward-dashboard-stats";
import type { StewardOwner, StewardTask, StewardTaskState } from "./steward-accountability";

/* A minimal task, real enough for the two fields the stats read: owner and
   state. Everything else is filled with honest, inert defaults. */
function task(
  overrides: Omit<Partial<StewardTask>, "owner"> & {
    state?: StewardTaskState;
    owner?: Partial<StewardOwner>;
  },
): StewardTask {
  const owner: StewardOwner = {
    kind: "human",
    key: "person",
    name: "Person",
    initials: "P",
    ...(overrides.owner ?? {}),
  };
  return {
    key: overrides.key ?? "manual:1",
    id: overrides.id ?? "1",
    origin: "manual",
    title: overrides.title ?? "A task",
    sourceLabel: "Test",
    owner,
    focus: "do_now",
    focusSetByHuman: false,
    state: overrides.state ?? "open",
    overdue: overrides.overdue ?? false,
    completionPath: "steward",
    evidence: [],
    why: "",
    rank: 0,
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...(overrides.dueAt ? { dueAt: overrides.dueAt } : {}),
  };
}

describe("empty inputs render honest zero and Level 1", () => {
  it("streak is 0 with no activity", () => {
    expect(computeStreakDays([], "2026-09-21T12:00:00.000Z")).toBe(0);
  });

  it("XP is 0 with no events", () => {
    expect(computeXp([])).toBe(0);
  });

  it("Level for 0 XP is Level 1", () => {
    const info = levelForXp(0);
    expect(info.level).toBe(1);
    expect(info.xpIntoLevel).toBe(0);
    expect(info.xpForLevel).toBe(50);
  });

  it("minutes saved is 0 with no events", () => {
    expect(computeMinutesSaved([])).toBe(0);
  });

  it("tasks completed is 0 of 0 with no tasks", () => {
    expect(computeTasksCompleted([])).toEqual({ done: 0, total: 0 });
  });
});

describe("computeStreakDays counts consecutive UTC days and a gap breaks it", () => {
  it("counts three consecutive days ending today", () => {
    const days = [
      "2026-09-21T09:00:00.000Z",
      "2026-09-20T22:00:00.000Z",
      "2026-09-19T01:00:00.000Z",
    ];
    expect(computeStreakDays(days, "2026-09-21T12:00:00.000Z")).toBe(3);
  });

  it("collapses several actions on one day into a single day", () => {
    const days = [
      "2026-09-21T08:00:00.000Z",
      "2026-09-21T09:00:00.000Z",
      "2026-09-21T23:00:00.000Z",
    ];
    expect(computeStreakDays(days, "2026-09-21T12:00:00.000Z")).toBe(1);
  });

  it("still runs from yesterday when today has no activity", () => {
    const days = ["2026-09-20T10:00:00.000Z", "2026-09-19T10:00:00.000Z"];
    expect(computeStreakDays(days, "2026-09-21T12:00:00.000Z")).toBe(2);
  });

  it("a missing day breaks the streak", () => {
    // Today and two days ago, but the day between is missing.
    const days = ["2026-09-21T10:00:00.000Z", "2026-09-19T10:00:00.000Z"];
    expect(computeStreakDays(days, "2026-09-21T12:00:00.000Z")).toBe(1);
  });

  it("is 0 when the last activity was more than a day ago", () => {
    const days = ["2026-09-18T10:00:00.000Z"];
    expect(computeStreakDays(days, "2026-09-21T12:00:00.000Z")).toBe(0);
  });
});

describe("computeXp sums weights and ignores unknown event types", () => {
  it("sums known weights", () => {
    const xp = computeXp([
      { eventType: "task.completed" }, // 50
      { eventType: "proposal.confirmed" }, // 40
      { eventType: "task.status_changed" }, // 30
    ]);
    expect(xp).toBe(120);
  });

  it("an unknown event type is worth 0", () => {
    expect(xpForEvent("something.made.up")).toBe(0);
    const xp = computeXp([
      { eventType: "task.completed" }, // 50
      { eventType: "something.made.up" }, // 0
    ]);
    expect(xp).toBe(50);
  });
});

describe("levelForXp curve boundaries", () => {
  it("just below the Level 2 boundary is still Level 1", () => {
    // Level 2 begins at 50 XP.
    const info = levelForXp(49);
    expect(info.level).toBe(1);
    expect(info.xpIntoLevel).toBe(49);
    expect(info.xpForLevel).toBe(50);
  });

  it("exactly at the Level 2 boundary is Level 2", () => {
    const info = levelForXp(50);
    expect(info.level).toBe(2);
    expect(info.xpIntoLevel).toBe(0);
    // Level 2 starts at 50, Level 3 starts at 200, so the band is 150.
    expect(info.xpForLevel).toBe(150);
  });

  it("exactly at the Level 3 boundary is Level 3 and labelled Operator", () => {
    const info = levelForXp(200);
    expect(info.level).toBe(3);
    expect(info.label).toBe("Operator");
  });

  it("treats negative XP as zero, honest Level 1", () => {
    expect(levelForXp(-100).level).toBe(1);
  });
});

describe("computeMinutesSaved ignores rows with no real estimate", () => {
  it("sums only agent rows that carry a positive estimate", () => {
    const minutes = computeMinutesSaved([
      { actorIsAgent: true, minutesSaved: 30 },
      { actorIsAgent: true, minutesSaved: 90 },
      { actorIsAgent: true }, // no estimate, contributes 0
      { actorIsAgent: false, minutesSaved: 999 }, // not an agent, ignored
    ]);
    expect(minutes).toBe(120);
  });

  it("is 0 when no agent row has an estimate", () => {
    expect(computeMinutesSaved([{ actorIsAgent: true }, { actorIsAgent: true }])).toBe(0);
  });
});

describe("computeTasksCompleted counts and respects owner scope", () => {
  const tasks: StewardTask[] = [
    task({ key: "a", state: "complete", owner: { userId: "u1", key: "u1" } }),
    task({ key: "b", state: "open", owner: { userId: "u1", key: "u1" } }),
    task({ key: "c", state: "complete", owner: { userId: "u2", key: "u2" } }),
  ];

  it("counts every task when no owner is given", () => {
    expect(computeTasksCompleted(tasks)).toEqual({ done: 2, total: 3 });
  });

  it("counts only one person's tasks when scoped by owner user id", () => {
    expect(computeTasksCompleted(tasks, "u1")).toEqual({ done: 1, total: 2 });
  });

  it("is 0 of 0 for an owner with no tasks", () => {
    expect(computeTasksCompleted(tasks, "nobody")).toEqual({ done: 0, total: 0 });
  });
});
