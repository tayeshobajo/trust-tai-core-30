import { describe, expect, it } from "vitest";

import { milestoneLifecycle } from "./milestone-lifecycle";
import type { AcceptanceCriterion } from "./milestone-criteria";
import type { RoadmapMilestone } from "./roadmap-intel";

const NOW = "2026-09-07T10:00:00.000Z";

function milestone(over: Partial<RoadmapMilestone> = {}): RoadmapMilestone {
  return {
    id: "m1",
    organizationId: "org",
    roadmapId: "r1",
    name: "Front facing pages",
    whatWeBuild: "A rebuilt site",
    intendedUser: "Patients",
    supportingMarketDirection: "",
    clientAdvantage: "",
    currentGap: "",
    evidence: [],
    immediateValue: "",
    longTermValue: "",
    dependencies: [],
    executionBoundary: "",
    confidence: "medium",
    priorityScore: 10,
    priorityRationale: [],
    recommendedSequence: 1,
    status: "shortlisted",
    tier: "inferred",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as RoadmapMilestone;
}

function criterion(over: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {
    id: "c1",
    organizationId: "org",
    roadmapId: "r1",
    milestoneId: "m1",
    text: "Home page approved",
    done: false,
    position: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as AcceptanceCriterion;
}

const withOutcome = milestone({
  success: {
    outcome: "Pages approved",
    targetDate: null,
    successCheck: null,
    tier: "decided",
    recordedBy: "u1",
    recordedAt: NOW,
  },
});

describe("milestoneLifecycle", () => {
  it("asks for the outcome first, and names the action that fixes it", () => {
    const read = milestoneLifecycle(milestone(), []);
    expect(read.step).toBe("outcome");
    expect(read.fix).toBe("outcome");
    expect(read.fixLabel).toBe("Describe the outcome");
    expect(read.ready).toBe(false);
  });

  it("asks for conditions once success is described", () => {
    const read = milestoneLifecycle(withOutcome, []);
    expect(read.step).toBe("criteria");
    expect(read.progressLabel).toBe("");
    expect(read.ready).toBe(false);
  });

  it("counts only acceptance criteria, and stays unready while any is open", () => {
    const read = milestoneLifecycle(withOutcome, [
      criterion({ id: "c1", done: true }),
      criterion({ id: "c2", position: 2 }),
      criterion({ id: "c3", position: 3 }),
    ]);
    expect(read.progressLabel).toBe("1/3");
    expect(read.remaining).toContain("2 conditions");
    expect(read.ready).toBe(false);
  });

  it("becomes ready when every condition is checked, but never decides", () => {
    const read = milestoneLifecycle(withOutcome, [
      criterion({ id: "c1", done: true }),
      criterion({ id: "c2", position: 2, done: true }),
    ]);
    expect(read.step).toBe("acceptance");
    expect(read.ready).toBe(true);
    expect(read.headline).toContain("ready for your acceptance");
  });

  it("never reads roadmap approval as delivery completion", () => {
    // The real Mental Dental shape: approved into the roadmap, no outcome
    // written, one open condition, evidence attached.
    const read = milestoneLifecycle(
      milestone({ status: "approved", tier: "decided", evidence: [] }),
      [criterion({ done: false })],
    );
    expect(read.step).toBe("outcome");
    expect(read.ready).toBe(false);
    expect(read.fix).toBe("outcome");
    expect(read.headline).toContain("success looks like");
  });

  it("stays unready for an approved milestone whose conditions are open", () => {
    const read = milestoneLifecycle(
      milestone({ ...withOutcome, status: "approved", tier: "decided" }),
      [criterion({ done: false })],
    );
    expect(read.step).toBe("criteria");
    expect(read.ready).toBe(false);
    expect(read.progressLabel).toBe("0/1");
  });

  it("ignores criteria that belong to another milestone", () => {
    const read = milestoneLifecycle(withOutcome, [
      criterion({ id: "other", milestoneId: "m2", done: true }),
    ]);
    expect(read.progress.total).toBe(0);
  });
});

describe("milestoneLifecycle delivery acceptance", () => {
  const accepted = milestone({
    ...withOutcome,
    acceptance: {
      acceptedAt: "2026-09-07T10:00:00.000Z",
      acceptedBy: "u1",
      acceptedByLabel: "Tai",
      note: "Client signed off on the call.",
    },
  });

  it("reads complete from acceptance, not from roadmap approval", () => {
    const read = milestoneLifecycle(accepted, [criterion({ done: true })]);
    expect(read.step).toBe("accepted");
    expect(read.accepted).toBe(true);
    expect(read.ready).toBe(false);
    expect(read.headline).toContain("Accepted by Tai");
  });

  it("leaves an approved but unaccepted milestone merely ready", () => {
    const read = milestoneLifecycle(
      milestone({ ...withOutcome, status: "approved", tier: "decided" }),
      [criterion({ done: true })],
    );
    expect(read.accepted).toBe(false);
    expect(read.ready).toBe(true);
    expect(read.step).toBe("acceptance");
  });
});
