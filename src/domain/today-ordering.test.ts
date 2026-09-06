import { describe, expect, it } from "vitest";

import {
  floorBreaches,
  isFloorBreached,
  orderToday,
  todayRank,
  type TodayCandidate,
} from "./today-ordering";

function item(overrides: Partial<TodayCandidate> & { key: string }): TodayCandidate {
  return {
    kind: "decision_opportunity",
    count: 1,
    label: "something",
    slug: "conductor",
    ...overrides,
  };
}

describe("orderToday", () => {
  it("puts a broken promise above a missed floor, and a decision last", () => {
    const ordered = orderToday([
      item({ key: "c", kind: "decision_opportunity" }),
      item({ key: "b", kind: "floor_breach" }),
      item({ key: "a", kind: "obligation_at_risk" }),
    ]);
    expect(ordered.map((entry) => entry.key)).toEqual(["a", "b", "c"]);
  });

  it("reads the most overdue obligation first", () => {
    const ordered = orderToday([
      item({ key: "soon", kind: "obligation_at_risk", overdueDays: 0 }),
      item({ key: "late", kind: "obligation_at_risk", overdueDays: 4 }),
    ]);
    expect(ordered[0]?.key).toBe("late");
  });

  it("shows nothing rather than a zero", () => {
    expect(orderToday([item({ key: "a", count: 0 })])).toEqual([]);
  });

  it("gives the same answer twice for the same day", () => {
    const input = [
      item({ key: "b", kind: "floor_breach", count: 2 }),
      item({ key: "a", kind: "floor_breach", count: 2 }),
    ];
    expect(orderToday(input).map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(orderToday(input.slice().reverse()).map((entry) => entry.key)).toEqual(["a", "b"]);
  });

  it("keeps the charter order as the ranking", () => {
    expect(todayRank("obligation_at_risk")).toBeLessThan(todayRank("floor_breach"));
    expect(todayRank("floor_breach")).toBeLessThan(todayRank("decision_opportunity"));
  });
});

describe("floors", () => {
  it("counts a breach only below the agreed low end", () => {
    expect(isFloorBreached(9, 10)).toBe(true);
    expect(isFloorBreached(10, 10)).toBe(false);
    expect(isFloorBreached(12, 10)).toBe(false);
  });

  it("never breaches a floor nobody agreed", () => {
    expect(isFloorBreached(0, 0)).toBe(false);
  });

  it("reports the shortfall, not the actual", () => {
    const breaches = floorBreaches([
      { key: "first-touch", label: "first touches short of the week", actual: 6, floor: 10, slug: "comms" },
      { key: "discovery", label: "discovery calls short of the week", actual: 3, floor: 2, slug: "comms" },
    ]);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.count).toBe(4);
    expect(breaches[0]?.kind).toBe("floor_breach");
  });
});
