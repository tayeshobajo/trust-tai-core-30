import { describe, expect, it } from "vitest";

import { pageNumbers, paginate } from "@/data/pagination";

describe("personal dashboard pagination", () => {
  it("shows six tasks per page and preserves the full count", () => {
    const tasks = Array.from({ length: 14 }, (_, index) => `task-${index + 1}`);
    const view = paginate(tasks, 2, 6);
    expect(view.rows).toEqual(["task-7", "task-8", "task-9", "task-10", "task-11", "task-12"]);
    expect(view).toMatchObject({ page: 2, pageCount: 3, total: 14, from: 7, to: 12 });
  });

  it("shows five activities per page independently", () => {
    const activities = Array.from({ length: 11 }, (_, index) => `activity-${index + 1}`);
    const view = paginate(activities, 2, 5);
    expect(view.rows).toEqual(["activity-6", "activity-7", "activity-8", "activity-9", "activity-10"]);
    expect(view).toMatchObject({ page: 2, pageCount: 3, total: 11, from: 6, to: 10 });
  });

  it("clamps a stale page after a task or activity mutation", () => {
    expect(paginate(["one", "two"], 4, 6).page).toBe(1);
    expect(paginate(Array.from({ length: 6 }), 2, 5).page).toBe(2);
  });

  it("keeps large page sets compact", () => {
    expect(pageNumbers(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
  });
});