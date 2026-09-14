import { describe, expect, it } from "vitest";

import { buildWorkBoard, overdueAt, showingNote } from "./comms-work-board";
import type { PlanItem } from "./comms-plan";

const now = new Date("2026-09-14T12:00:00.000Z");

function item(partial: Partial<PlanItem> & Pick<PlanItem, "id" | "kind">): PlanItem {
  return {
    relationshipId: "r1",
    personName: "Adaeze",
    companyName: null,
    prospectId: null,
    title: "t",
    reason: "because a person recorded it",
    dueAt: null,
    overdue: false,
    ...partial,
  };
}

describe("the work board", () => {
  it("puts an overdue follow-up in the actionable list", () => {
    const board = buildWorkBoard(
      [item({ id: "f", kind: "follow_up", dueAt: "2026-09-01T09:00:00.000Z" })],
      now,
    );
    expect(board.pastDue.total).toBe(1);
    expect(board.upcoming.total).toBe(0);
  });

  it("keeps a past meeting separate, without calling it unfulfilled", () => {
    const board = buildWorkBoard(
      [item({ id: "m", kind: "meeting", dueAt: "2026-09-02T09:00:00.000Z" })],
      now,
    );
    expect(board.pastDue.total).toBe(0);
    expect(board.meetingsNeedingRecord.total).toBe(1);
  });

  it("recomputes overdue against the clock it is given, not a stored flag", () => {
    const stale = item({ id: "c", kind: "commitment", dueAt: "2026-09-13T09:00:00.000Z" });
    expect(overdueAt(stale, new Date("2026-09-12T00:00:00.000Z"))).toBe(false);
    expect(overdueAt(stale, now)).toBe(true);
  });

  it("counts everything that qualifies, whatever is displayed", () => {
    const many = Array.from({ length: 24 }, (_, index) =>
      item({ id: `u${index}`, kind: "follow_up", dueAt: "2026-10-01T09:00:00.000Z" }),
    );
    const board = buildWorkBoard(many, now);
    expect(board.upcoming.total).toBe(24);
    expect(showingNote(10, board.upcoming.total)).toBe("Showing 10 of 24.");
    expect(showingNote(24, 24)).toBeNull();
  });

  it("lists replies owed on their own", () => {
    const board = buildWorkBoard([item({ id: "r", kind: "reply_due" })], now);
    expect(board.repliesOwed.total).toBe(1);
    expect(board.pastDue.total).toBe(0);
  });
});
