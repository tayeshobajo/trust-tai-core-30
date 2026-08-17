import { describe, expect, it } from "vitest";

import type { Roadmap, RoadmapDecision } from "@/domain/roadmap";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";
import type { RoadmapExecutionLink, RoadmapExport } from "@/domain/roadmap-exports";

import {
  buildExportSnapshot,
  buildMilestonePath,
  currentMilestone,
  exportFreshness,
  nextAttention,
  pathProgress,
} from "./projection";

const NOW = "2026-01-01T00:00:00.000Z";

function milestone(overrides: Partial<RoadmapMilestone> = {}): RoadmapMilestone {
  return {
    id: "m1",
    organizationId: "org",
    roadmapId: "r1",
    name: "Booking engine",
    whatWeBuild: "A booking engine on their own domain",
    intendedUser: "New patients",
    supportingMarketDirection: "",
    clientAdvantage: "",
    currentGap: "Bookings go through a third party",
    evidence: [{ label: "Site", url: "https://example.com", checkedAt: NOW }],
    immediateValue: "Owned booking data",
    longTermValue: "",
    dependencies: [],
    executionBoundary: "",
    confidence: "moderate",
    priorityScore: 60,
    priorityRationale: [],
    recommendedSequence: 1,
    status: "approved",
    tier: "decided",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function roadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: "r1",
    organizationId: "org",
    title: "Elevate Orthodontics",
    subjectLabel: "Elevate Orthodontics",
    objective: "Own the patient journey",
    status: "in_progress",
    pointA: [
      {
        label: "Today",
        value: "Bookings sit with a third party",
        tier: "observed",
        evidence: [],
        at: NOW,
      },
    ],
    pointB: {
      statement: "Own the whole patient journey",
      tier: "decided",
      because: "",
      evidence: [],
    },
    nextMove: null,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function link(overrides: Partial<RoadmapExecutionLink> = {}): RoadmapExecutionLink {
  return {
    id: "l1",
    organizationId: "org",
    roadmapId: "r1",
    milestoneId: "m1",
    owningApp: "projects",
    status: "in_progress",
    createdAt: NOW,
    ...overrides,
  };
}

function decision(overrides: Partial<RoadmapDecision> = {}): RoadmapDecision {
  return {
    id: "d1",
    organizationId: "org",
    roadmapId: "r1",
    question: "Do we replace the booking vendor?",
    whyItMatters: "Everything downstream depends on owning the data",
    options: [],
    evidence: [],
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("buildMilestonePath", () => {
  it("orders by recommended sequence and numbers the path", () => {
    const path = buildMilestonePath(
      [
        milestone({ id: "b", name: "Second", recommendedSequence: 2 }),
        milestone({ id: "a", name: "First", recommendedSequence: 1 }),
      ],
      [],
      [],
    );
    expect(path.map((entry) => entry.name)).toEqual(["First", "Second"]);
    expect(path.map((entry) => entry.ordinal)).toEqual(["01", "02"]);
  });

  it("leaves rejected candidates out of the path", () => {
    const path = buildMilestonePath([milestone({ status: "rejected" })], [], []);
    expect(path).toHaveLength(0);
  });

  it("reads execution state from the owning room, not from approval", () => {
    const [entry] = buildMilestonePath([milestone()], [link()], []);
    expect(entry?.state).toBe("in_progress");

    const [done] = buildMilestonePath([milestone()], [link({ status: "complete" })], []);
    expect(done?.state).toBe("complete");

    const [withdrawn] = buildMilestonePath([milestone()], [link({ status: "withdrawn" })], []);
    expect(withdrawn?.state).toBe("ready");
  });

  it("keeps a proposal a proposal until a person decides it", () => {
    const [entry] = buildMilestonePath(
      [milestone({ status: "candidate", tier: "inferred" })],
      [],
      [],
    );
    expect(entry?.state).toBe("proposed");
    expect(entry?.decided).toBe(false);
  });

  it("blocks a milestone that has an open decision against it", () => {
    const [entry] = buildMilestonePath([milestone()], [], [decision({ stageId: "m1" })]);
    expect(entry?.state).toBe("blocked");
    expect(entry?.openDecision?.id).toBe("d1");
  });
});

describe("currentMilestone and pathProgress", () => {
  it("prefers work in motion, then blocked, then the next ready step", () => {
    const path = buildMilestonePath(
      [
        milestone({ id: "a", recommendedSequence: 1 }),
        milestone({ id: "b", recommendedSequence: 2 }),
      ],
      [link({ milestoneId: "b" })],
      [],
    );
    expect(currentMilestone(path)?.id).toBe("b");
  });

  it("counts completion against the whole path", () => {
    const path = buildMilestonePath(
      [
        milestone({ id: "a", recommendedSequence: 1 }),
        milestone({ id: "b", recommendedSequence: 2 }),
      ],
      [link({ milestoneId: "a", status: "complete" })],
      [],
    );
    expect(pathProgress(path)).toMatchObject({ total: 2, complete: 1, percent: 50 });
  });
});

describe("nextAttention", () => {
  it("puts an open decision above everything else", () => {
    const path = buildMilestonePath([milestone()], [], []);
    expect(nextAttention(roadmap(), path, [decision()])).toMatchObject({ kind: "decision" });
  });

  it("asks for the destination before it sequences anything", () => {
    const path = buildMilestonePath([milestone()], [], []);
    expect(nextAttention(roadmap({ pointB: null }), path, [])).toMatchObject({
      kind: "destination",
    });
  });

  it("names an unowned milestone that is already in motion", () => {
    const path = buildMilestonePath([milestone()], [link()], []);
    expect(nextAttention(roadmap(), path, [])).toMatchObject({ kind: "owner" });
  });

  it("offers the next approved milestone when nothing is blocking", () => {
    const path = buildMilestonePath([milestone()], [], []);
    expect(nextAttention(roadmap(), path, [])).toMatchObject({ kind: "start" });
  });

  it("says so plainly when nothing needs judgment", () => {
    const path = buildMilestonePath([milestone()], [link({ status: "complete" })], []);
    expect(nextAttention(roadmap(), path, [])).toMatchObject({ kind: "settled" });
  });
});

describe("exports", () => {
  const copy: RoadmapExport = {
    id: "e1",
    organizationId: "org",
    roadmapId: "r1",
    version: "1.0",
    status: "sent",
    snapshot: {
      company: "Elevate",
      pointA: [],
      pointB: "",
      pointBProposed: false,
      milestones: [],
      evidence: [],
      generatedAt: NOW,
    },
    createdAt: NOW,
  };

  it("flags a client copy that the roadmap has moved past", () => {
    const later = roadmap({ updatedAt: "2026-02-01T00:00:00.000Z" });
    expect(exportFreshness(later, [copy]).behind).toBe(true);
    expect(exportFreshness(roadmap(), [copy]).behind).toBe(false);
    expect(exportFreshness(roadmap(), []).latest).toBeNull();
  });

  it("carries only decided milestones into a client copy", () => {
    const path = buildMilestonePath(
      [milestone({ id: "a" }), milestone({ id: "b", status: "candidate", tier: "inferred" })],
      [],
      [],
    );
    const snapshot = buildExportSnapshot(roadmap(), path, { now: new Date(NOW) });
    expect(snapshot.milestones).toHaveLength(1);
    expect(snapshot.pointBProposed).toBe(false);
  });

  it("labels a proposed destination as a proposal rather than hiding it", () => {
    const proposed = roadmap({
      pointB: { statement: "Own the journey", tier: "inferred", because: "", evidence: [] },
    });
    const snapshot = buildExportSnapshot(proposed, [], { now: new Date(NOW) });
    expect(snapshot.pointBProposed).toBe(true);
  });
});
