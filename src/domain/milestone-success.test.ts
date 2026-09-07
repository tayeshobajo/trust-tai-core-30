import { describe, expect, it } from "vitest";

import {
  NO_SUCCESS,
  checkMilestoneSuccess,
  readMilestoneSuccess,
  sameSuccess,
  successEventKey,
  successSummary,
} from "./milestone-success";

describe("milestone success definition", () => {
  it("takes a plain outcome on its own, with no numbers at all", () => {
    const checked = checkMilestoneSuccess({ outcome: "Front facing pages approved" });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.success.targetDate).toBeNull();
    expect(checked.success.successCheck).toBeNull();
  });

  it("keeps the target date a person typed, and never invents today", () => {
    const withDate = checkMilestoneSuccess({
      outcome: "Front facing pages approved",
      targetDate: "2026-09-30",
    });
    expect(withDate.ok && withDate.success.targetDate).toBe("2026-09-30");

    const without = checkMilestoneSuccess({ outcome: "Front facing pages approved" });
    expect(without.ok && without.success.targetDate).toBeNull();
  });

  it("refuses a missing outcome and an unreal date", () => {
    expect(checkMilestoneSuccess({ outcome: "  " }).ok).toBe(false);
    expect(
      checkMilestoneSuccess({ outcome: "Pages approved", targetDate: "2026-13-40" }).ok,
    ).toBe(false);
  });

  it("reads a stored definition back, and refuses a partial one", () => {
    const stored = {
      outcome: "Pages approved",
      targetDate: "2026-09-30",
      successCheck: null,
      tier: "decided",
      recordedBy: "user-1",
      recordedAt: "2026-09-07T12:00:00.000Z",
    };
    expect(readMilestoneSuccess(stored)?.outcome).toBe("Pages approved");
    expect(readMilestoneSuccess({ ...stored, recordedBy: "" })).toBeNull();
    expect(readMilestoneSuccess(null)).toBeNull();
  });

  it("says nothing rather than something when there is no outcome", () => {
    expect(successSummary(null)).toBe(NO_SUCCESS);
  });

  it("treats the same words as the same fact", () => {
    const a = { outcome: "Pages approved", targetDate: null, successCheck: null };
    expect(sameSuccess(a, { ...a })).toBe(true);
    expect(sameSuccess(a, { ...a, targetDate: "2026-09-30" })).toBe(false);
    expect(successEventKey("m1", null)).toBe("roadmap.outcome_cleared:m1");
  });
});
