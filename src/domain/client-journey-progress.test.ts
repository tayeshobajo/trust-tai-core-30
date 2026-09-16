import { describe, expect, it } from "vitest";

import { answered, unreadable, type RoadmapOutcome } from "./client-shell";
import {
  clientJourneyProgress,
  currentJourneyStage,
  type ClientJourneyInput,
} from "./client-journey-progress";
import type { ExecutionProject } from "./projects";

const roadmap = (patch: Partial<RoadmapOutcome> = {}): RoadmapOutcome => ({
  roadmapId: "r1",
  title: "Acme path",
  statusLabel: "Active",
  active: true,
  destination: "Point B",
  destinationTier: "decided",
  milestone: "Phase one",
  milestoneStateLabel: "Live",
  milestoneBlocked: false,
  nextMove: null,
  openDecisions: 0,
  stagesLive: 1,
  stagesTotal: 3,
  ...patch,
});

const project = (patch: Partial<ExecutionProject> = {}): ExecutionProject =>
  ({
    id: "p1",
    organizationId: "o1",
    name: "Acme build",
    state: "in_progress",
    pointA: "A",
    pointB: "B",
    ...patch,
  }) as ExecutionProject;

const base: ClientJourneyInput = {
  clientId: "c1",
  relationship: answered({ peopleCount: 2, lastExchangeAt: "2026-09-01T00:00:00.000Z" }),
  roadmap: answered(roadmap()),
  proposals: answered([
    { id: "pr1", title: "Acme proposal", sentAt: "2026-09-02T00:00:00.000Z", outcome: "signed", amountCents: 500_00 },
  ]),
  commercial: answered({
    tier: "run",
    mrrCents: 200_00,
    nextReviewAt: "2026-10-01T00:00:00.000Z",
    renewalAt: null,
    recordedAt: "2026-09-03T00:00:00.000Z",
  }),
  projects: answered([project()]),
};

describe("client journey progress", () => {
  it("returns the seven stages in order with their contracts", () => {
    const stages = clientJourneyProgress(base);
    expect(stages.map((stage) => stage.stage)).toEqual([
      "qualify",
      "discovery",
      "roadmap",
      "proposal",
      "agreement",
      "delivery",
      "care",
    ]);
    expect(stages[0]?.expected).toBeTruthy();
    expect(stages[0]?.decidedBy).toBeTruthy();
  });

  it("marks a room that could not be read as unreadable, not empty", () => {
    const stages = clientJourneyProgress({
      ...base,
      projects: unreadable("Delivery refused the read."),
    });
    const delivery = stages.find((stage) => stage.stage === "delivery")!;
    expect(delivery.state).toBe("unreadable");
    expect(delivery.because).toBe("Delivery refused the read.");
  });

  it("never claims a destination is agreed when nobody approved it", () => {
    const stages = clientJourneyProgress({
      ...base,
      roadmap: answered(roadmap({ destinationTier: "inferred" })),
    });
    const stage = stages.find((entry) => entry.stage === "roadmap")!;
    expect(stage.state).toBe("in_progress");
    expect(stage.nextAction).toContain("approved");
  });

  it("blocks the roadmap stage while decisions wait on a person", () => {
    const stages = clientJourneyProgress({
      ...base,
      roadmap: answered(roadmap({ openDecisions: 2 })),
    });
    expect(stages.find((entry) => entry.stage === "roadmap")?.state).toBe("blocked");
  });

  it("shows a proposal awaiting a decision as in progress, not accepted", () => {
    const stages = clientJourneyProgress({
      ...base,
      proposals: answered([
        { id: "pr1", title: "Acme", sentAt: "2026-09-02T00:00:00.000Z", outcome: "open", amountCents: null },
      ]),
    });
    expect(stages.find((entry) => entry.stage === "proposal")?.state).toBe("in_progress");
  });

  it("names the blocked delivery owner and only shows a confirmed date", () => {
    const stages = clientJourneyProgress({
      ...base,
      projects: answered([
        project({
          state: "blocked",
          blockedBecause: "Waiting on their data export.",
          ownerLabel: "Sam",
          dueDate: "2026-10-15T00:00:00.000Z",
        }),
      ]),
    });
    const delivery = stages.find((entry) => entry.stage === "delivery")!;
    expect(delivery.state).toBe("blocked");
    expect(delivery.owner).toBe("Sam");
    expect(delivery.dueAt).toBe("2026-10-15T00:00:00.000Z");
    expect(stages.find((entry) => entry.stage === "qualify")?.dueAt).toBeNull();
  });

  it("does not put a client on the book without recorded commercial state", () => {
    const stages = clientJourneyProgress({
      ...base,
      commercial: answered({
        tier: null,
        mrrCents: null,
        nextReviewAt: null,
        renewalAt: null,
        recordedAt: null,
      }),
    });
    expect(stages.find((entry) => entry.stage === "agreement")?.state).toBe("not_started");
    expect(stages.find((entry) => entry.stage === "care")?.state).toBe("not_started");
  });

  it("points at the earliest stage that needs a person", () => {
    const stages = clientJourneyProgress({
      ...base,
      roadmap: answered(roadmap({ openDecisions: 1 })),
    });
    expect(currentJourneyStage(stages)?.stage).toBe("roadmap");
  });
});
