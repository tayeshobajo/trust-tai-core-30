import { describe, expect, it } from "vitest";

import { milestoneActionPrompt, milestoneActions } from "./milestone-actions";

describe("milestoneActions", () => {
  it("never offers the status a milestone already holds", () => {
    for (const status of [
      "candidate",
      "shortlisted",
      "approved",
      "rejected",
      "deferred",
    ] as const) {
      expect(milestoneActions(status).some((action) => action.status === status)).toBe(false);
    }
  });

  it("offers defer and reject on an approved milestone, but not approve", () => {
    const labels = milestoneActions("approved").map((action) => action.label);
    expect(labels).toContain("Defer");
    expect(labels).toContain("Reject");
    expect(labels).not.toContain("Approve");
  });

  it("reads as a plain confirmation", () => {
    expect(milestoneActionPrompt("deferred")).toBe("Mark this milestone deferred");
  });
});
