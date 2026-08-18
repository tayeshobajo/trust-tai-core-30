import { describe, expect, it } from "vitest";

import {
  blockerAgeDays,
  completionModel,
  currentWorkItem,
  healthSignals,
  needsJudgment,
  peopleOnProject,
  standsLine,
  upNextItem,
  workProgress,
} from "./detail-projection";
import type { ProjectBlocker, ProjectDecision, WorkItem } from "@/domain/project-delivery";
import type { ExecutionProject } from "@/domain/projects";

const NOW = new Date("2026-08-18T00:00:00.000Z");

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "p1",
    organizationId: "org",
    name: "Granite Bay Local Search",
    state: "in_flight",
    ownerLabel: "Tai",
    pointA: "Low local visibility.",
    pointB: "Strengthen local visibility.",
    nextMove: "Finish the profile work.",
    evidence: [],
    dependencies: [],
    origin: { kind: "roadmap_milestone", roadmapId: "r1", milestoneId: "m1" },
    lastMovedAt: NOW.toISOString(),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "w1",
    organizationId: "org",
    projectId: "p1",
    title: "Optimize Google Business Profile",
    status: "ready",
    sequence: 0,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function blocker(overrides: Partial<ProjectBlocker> = {}): ProjectBlocker {
  return {
    id: "b1",
    organizationId: "org",
    projectId: "p1",
    reason: "Waiting on access to the profile.",
    status: "open",
    raisedAt: "2026-08-15T00:00:00.000Z",
    createdAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("current work and up next", () => {
  const items = [
    work({ id: "a", sequence: 0, status: "complete" }),
    work({ id: "b", sequence: 1, status: "in_progress", title: "Profile optimization" }),
    work({ id: "c", sequence: 2, status: "ready", title: "Local listings cleanup" }),
    work({ id: "d", sequence: 3, status: "ready", title: "Review workflow" }),
  ];

  it("reads the one item in progress", () => {
    expect(currentWorkItem(items)?.title).toBe("Profile optimization");
  });

  it("reads up next from the recorded sequence, not creation order", () => {
    expect(upNextItem(items)?.title).toBe("Local listings cleanup");
  });

  it("says nothing is moving when nothing is in progress", () => {
    expect(currentWorkItem([work({ status: "ready" })])).toBeNull();
  });
});

describe("progress", () => {
  it("counts complete items honestly", () => {
    const progress = workProgress([
      work({ id: "a", status: "complete" }),
      work({ id: "b", status: "complete" }),
      work({ id: "c", status: "ready" }),
    ]);
    expect(progress.line).toBe("2 of 3 items complete");
    expect(progress.percent).toBe(67);
  });

  it("does not invent progress when nothing was recorded", () => {
    expect(workProgress([]).line).toBe("No work items recorded yet.");
  });
});

describe("where this stands", () => {
  it("leads with a live blocker and its age", () => {
    const line = standsLine(project(), [work({ status: "in_progress" })], [blocker()], NOW);
    expect(line).toContain("Delivery is stopped");
    expect(line).toContain("Blocked for 3 days");
  });

  it("says work is moving when nothing is stopping it", () => {
    expect(standsLine(project(), [work({ status: "in_progress" })], [], NOW)).toBe(
      "Work is moving normally. No active blocker is preventing delivery.",
    );
  });

  it("names a passed date before anything else that is quiet", () => {
    const line = standsLine(
      project({ dueDate: "2026-08-15T00:00:00.000Z" }),
      [work({ status: "in_progress" })],
      [],
      NOW,
    );
    expect(line).toContain("passed 3 days ago");
  });
});

describe("health signals", () => {
  it("explains the state rather than scoring it", () => {
    const signals = healthSignals(
      project(),
      [
        work({ id: "a", status: "complete" }),
        work({ id: "b", status: "ready", dueDate: "2026-08-20T00:00:00.000Z" }),
      ],
      [],
      NOW,
    );
    expect(signals).toContain("1 of 2 items complete");
    expect(signals).toContain("No active blockers");
    expect(signals).toContain("Next due item in 2 days");
    expect(signals).toContain("Carried by Tai");
  });
});

describe("needs judgment", () => {
  const decision: ProjectDecision = {
    id: "d1",
    organizationId: "org",
    projectId: "p1",
    question: "Approve the copy direction?",
    status: "open",
    createdAt: NOW.toISOString(),
  };

  it("surfaces open decisions, blockers and reviews only", () => {
    const items = needsJudgment(
      project(),
      [work({ status: "in_review", title: "Listings" }), work({ id: "z", status: "complete" })],
      [blocker(), blocker({ id: "b2", status: "resolved" })],
      [decision, { ...decision, id: "d2", status: "answered" }],
      NOW,
    );
    expect(items.map((entry) => entry.title)).toEqual([
      "Approve the copy direction?",
      "Waiting on access to the profile.",
      "Listings",
    ]);
  });

  it("is empty when nothing asks for judgment", () => {
    expect(needsJudgment(project(), [work({ status: "in_progress" })], [], [], NOW)).toHaveLength(0);
  });

  it("names unowned work as needing a person", () => {
    const items = needsJudgment(project({ ownerLabel: "" }), [], [], [], NOW);
    expect(items[0]?.title).toBe("Nobody carries this project");
  });
});

describe("blocker ageing", () => {
  it("counts from when it was raised", () => {
    expect(blockerAgeDays(blocker(), NOW)).toBe(3);
  });
});

describe("completion", () => {
  it("reads as an outcome and signals Roadmap without changing it", () => {
    const model = completionModel(
      project({ state: "delivered" }),
      [work({ id: "a", status: "complete", title: "Profile optimized" })],
      "Milestone 02",
    );
    expect(model.changed).toEqual(["Profile optimized"]);
    expect(model.roadmapSignal).toBe("Milestone 02 is ready to be marked complete in Roadmap.");
  });

  it("has no roadmap signal for work started here", () => {
    const model = completionModel(project({ origin: { kind: "manual" } }), []);
    expect(model.roadmapSignal).toBeNull();
  });
});

describe("people", () => {
  it("lists the owner and contributors once each", () => {
    const people = peopleOnProject(project(), [
      work({ id: "a", ownerLabel: "Maya" }),
      work({ id: "b", ownerLabel: "Maya" }),
      work({ id: "c", ownerLabel: "Tai" }),
    ]);
    expect(people).toEqual([
      { label: "Tai", role: "Project owner" },
      { label: "Maya", role: "Contributor" },
    ]);
  });
});
