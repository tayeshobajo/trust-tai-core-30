import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_MET,
  NO_CRITERIA,
  canRemoveCriterion,
  checkCriterionText,
  criteriaProgress,
  criteriaSummary,
  criterionEventKey,
  findSameCriterion,
  nextCriterionPosition,
  reorderCriteria,
  sortCriteria,
  type AcceptanceCriterion,
} from "./milestone-criteria";

function criterion(patch: Partial<AcceptanceCriterion>): AcceptanceCriterion {
  return {
    id: "c1",
    organizationId: "org-1",
    roadmapId: "road-1",
    milestoneId: "mile-1",
    text: "Home page approved",
    position: 1,
    done: false,
    createdBy: "user-1",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...patch,
  };
}

describe("milestone acceptance criteria", () => {
  it("accepts a real condition and tidies the spacing", () => {
    const checked = checkCriterionText("  Checkout page   approved and tested ");
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.text).toBe("Checkout page approved and tested");
  });

  it("refuses an empty or unreadably short condition", () => {
    expect(checkCriterionText("   ").ok).toBe(false);
    expect(checkCriterionText("ok").ok).toBe(false);
    expect(checkCriterionText("x".repeat(201)).ok).toBe(false);
  });

  it("does not write the same condition twice", () => {
    const rows = [criterion({})];
    expect(findSameCriterion(rows, "home page approved")?.id).toBe("c1");
    expect(findSameCriterion(rows, "About page approved")).toBeNull();
  });

  it("keeps a stable order and appends new conditions to the end", () => {
    const rows = [
      criterion({ id: "b", position: 2, text: "About" }),
      criterion({ id: "a", position: 1, text: "Home" }),
    ];
    expect(sortCriteria(rows).map((row) => row.id)).toEqual(["a", "b"]);
    expect(nextCriterionPosition(rows)).toBe(3);
  });

  it("reads an empty checklist as empty, never as met", () => {
    expect(criteriaProgress([])).toEqual({ done: 0, total: 0, met: false });
    expect(criteriaSummary([])).toBe(NO_CRITERIA);
  });

  it("says acceptance criteria are met only when every box is checked", () => {
    const rows = [
      criterion({ id: "a", done: true }),
      criterion({ id: "b", position: 2, text: "About", done: false }),
    ];
    expect(criteriaSummary(rows)).toBe("1 of 2 conditions met");
    const all = rows.map((row) => ({ ...row, done: true }));
    expect(criteriaProgress(all).met).toBe(true);
    expect(criteriaSummary(all)).toBe(ACCEPTANCE_MET);
  });

  it("lets an unused condition be removed and protects a checked one", () => {
    expect(canRemoveCriterion(criterion({})).ok).toBe(true);
    expect(canRemoveCriterion(criterion({ done: true })).ok).toBe(false);
  });

  it("moves one condition without disturbing the rest", () => {
    const rows = [
      criterion({ id: "a", position: 1, text: "Home" }),
      criterion({ id: "b", position: 2, text: "About" }),
      criterion({ id: "c", position: 3, text: "Services" }),
    ];
    const moves = reorderCriteria(rows, "c", "up");
    expect(moves).toEqual([
      { id: "c", position: 2 },
      { id: "b", position: 3 },
    ]);
    expect(reorderCriteria(rows, "a", "up")).toEqual([]);
    expect(reorderCriteria(rows, "c", "down")).toEqual([]);
  });

  it("gives one condition one stable replay key", () => {
    expect(criterionEventKey("mile-1", " Home Page Approved ")).toBe(
      "roadmap.criterion_added:mile-1:home page approved",
    );
  });
});
