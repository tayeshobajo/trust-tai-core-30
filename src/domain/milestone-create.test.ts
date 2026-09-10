import { describe, expect, it } from "vitest";

import {
  MAX_MILESTONE_NAME,
  checkManualMilestone,
  findSameName,
  manualMilestoneKey,
  nextSequence,
  normalizeMilestoneName,
} from "./milestone-create";

describe("checkManualMilestone", () => {
  it("refuses an empty name", () => {
    const result = checkManualMilestone({ name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toMatch(/name/i);
  });

  it("refuses a name that is too short", () => {
    const result = checkManualMilestone({ name: "ab" });
    expect(result.ok).toBe(false);
  });

  it("refuses a name that is too long", () => {
    const result = checkManualMilestone({ name: "x".repeat(MAX_MILESTONE_NAME + 1) });
    expect(result.ok).toBe(false);
  });

  it("accepts a name alone and leaves the rest honestly empty", () => {
    const result = checkManualMilestone({ name: "  Launch the   INBDE question bank " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.milestone.name).toBe("Launch the INBDE question bank");
      expect(result.milestone.whatWeBuild).toBe("");
      expect(result.milestone.executionBoundary).toBe("");
    }
  });

  it("keeps the optional detail a person actually typed", () => {
    const result = checkManualMilestone({
      name: "Question bank",
      whatWeBuild: " A graded bank of 500 items ",
      executionBoundary: "Content authoring stays with the client",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.milestone.whatWeBuild).toBe("A graded bank of 500 items");
      expect(result.milestone.executionBoundary).toBe("Content authoring stays with the client");
    }
  });
});

describe("replay and ordering helpers", () => {
  it("builds the same replay key for the same milestone typed differently", () => {
    expect(manualMilestoneKey("r1", " Question  Bank ")).toBe(
      manualMilestoneKey("r1", "question bank"),
    );
  });

  it("separates replay keys by roadmap", () => {
    expect(manualMilestoneKey("r1", "Question bank")).not.toBe(
      manualMilestoneKey("r2", "Question bank"),
    );
  });

  it("starts at one on an empty roadmap and continues after the highest", () => {
    expect(nextSequence([])).toBe(1);
    expect(nextSequence([{ recommendedSequence: 3 }, { recommendedSequence: 7 }])).toBe(8);
  });

  it("finds an existing milestone with the same name", () => {
    const existing = [{ name: "Question bank" }, { name: "Mock exams" }];
    expect(findSameName(existing, "  question   BANK ")?.name).toBe("Question bank");
    expect(findSameName(existing, "Tutoring")).toBeUndefined();
  });

  it("normalizes names for comparison only", () => {
    expect(normalizeMilestoneName("  A  B ")).toBe("a b");
  });
});
