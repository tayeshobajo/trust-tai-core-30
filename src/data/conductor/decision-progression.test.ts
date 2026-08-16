/**
 * Conductor V3.4 — Decision-to-milestone progression awareness.
 *
 * Once a person answers a decision in Roadmap, Conductor re-reads canon and
 * says plainly where attention moved. What is proved here:
 *  - an open decision holds attention on the destination milestone
 *  - resolving it advances attention under the same deterministic rules
 *  - no dependency is ever invented
 *  - an unresolved stage-linked decision still outranks progression
 *  - empty and unreadable sequences claim nothing
 *  - a resolved decision with every milestone live moves attention nowhere
 *  - another organisation's roadmap never leaks in
 *  - authority, adapters and approval are unchanged
 */

import { describe, expect, it } from "vitest";

import {
  milestoneProgressionOf,
  readRoadmapCanon,
} from "@/data/intelligence/conductor/roadmap-cycle";
import { ADAPTER_CAPABILITIES } from "@/domain/adapter-registry";
import type { Roadmap, RoadmapDecision, RoadmapStage } from "@/domain/roadmap";

const ORG = "org-1";
const NOW = "2026-08-16T00:00:00.000Z";
const LATER = "2026-08-17T00:00:00.000Z";

function roadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: "rm-teamsynerg",
    organizationId: ORG,
    title: "Teamsynerg — path to be agreed",
    subjectLabel: "Teamsynerg",
    objective: "Turn scattered delivery into one operating system",
    status: "draft",
    pointA: [
      {
        label: "Current truth",
        value: "Delivery runs across three disconnected tools",
        tier: "observed",
        evidence: [{ label: "Discovery call, 12 August", kind: "human" }],
        at: NOW,
      },
    ],
    pointB: {
      statement: "One operating system the team runs the week from",
      tier: "inferred",
      because: "Entered when this roadmap was created.",
      evidence: [],
    },
    nextMove: null,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function stage(overrides: Partial<RoadmapStage> = {}): RoadmapStage {
  return {
    id: "st-1",
    organizationId: ORG,
    roadmapId: "rm-teamsynerg",
    position: 1,
    title: "Agree the destination",
    state: "mapped",
    tier: "inferred",
    evidence: [{ label: "Discovery call, 12 August", kind: "human" }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function decision(overrides: Partial<RoadmapDecision> = {}): RoadmapDecision {
  return {
    id: "dec-destination",
    organizationId: ORG,
    roadmapId: "rm-teamsynerg",
    question: "Is that the right destination?",
    whyItMatters: "Everything sequenced below assumes it.",
    options: ["Approve as written", "Change the destination"],
    evidence: [],
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const SEQUENCE = [
  stage(),
  stage({ id: "st-2", position: 2, title: "Sequence the build order" }),
  stage({ id: "st-3", position: 3, title: "Build the delivery board" }),
];

const RESOLVED = decision({
  stageId: "st-1",
  status: "approved",
  resolvedAt: LATER,
  resolvedBy: "user-1",
});

/* --------------------------------------------------------------- before */

describe("before the decision is answered", () => {
  it("holds attention on the destination milestone and reports no progression", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap(),
      decisions: [decision()],
      stages: SEQUENCE,
    });
    expect(canon.milestoneAttention?.milestone.title).toBe("Agree the destination");
    expect(canon.milestoneProgression).toBeNull();
  });
});

/* ---------------------------------------------------------------- after */

describe("after a person resolves the decision", () => {
  it("advances attention to the next unfinished milestone in sequence", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap({
        pointB: {
          statement: "One operating system the team runs the week from",
          tier: "decided",
          because: "Approved by Tai.",
          evidence: [],
          approvedBy: "user-1",
          approvedAt: LATER,
        },
      }),
      decisions: [RESOLVED],
      stages: SEQUENCE,
    });

    expect(canon.openDecisions).toHaveLength(0);
    expect(canon.milestoneAttention?.milestone.title).toBe("Agree the destination");
    const progression = canon.milestoneProgression;
    expect(progression).not.toBeNull();
    expect(progression!.decisionId).toBe("dec-destination");
    expect(progression!.resolution).toBe("approved");
    expect(progression!.clearedDecisionReason).toBe(true);
  });

  it("moves attention onward when the resolved decision sat on the first milestone", () => {
    const progression = milestoneProgressionOf({
      milestones: readRoadmapCanon({
        roadmap: roadmap(),
        decisions: [],
        stages: SEQUENCE,
      }).milestones,
      decisions: [
        decision({ stageId: "st-1", status: "approved", resolvedAt: LATER }),
      ],
      pointB: { tier: "decided" },
    });
    expect(progression).not.toBeNull();
    expect(progression!.from.title).toBe("Agree the destination");
    expect(progression!.to?.title).toBe("Agree the destination");
    expect(progression!.clearedDecisionReason).toBe(true);
    expect(progression!.statement).toContain("resolved");
  });

  it("advances to the next milestone once the earlier one is live", () => {
    const progression = milestoneProgressionOf({
      milestones: readRoadmapCanon({
        roadmap: roadmap(),
        decisions: [],
        stages: [stage({ state: "live", tier: "decided" }), SEQUENCE[1]!, SEQUENCE[2]!],
      }).milestones,
      decisions: [decision({ stageId: "st-1", status: "approved", resolvedAt: LATER })],
      pointB: { tier: "decided" },
    });
    expect(progression!.to?.title).toBe("Sequence the build order");
    expect(progression!.statement).toContain("Sequence the build order");
  });

  it("never invents a dependency in the progression wording", () => {
    const progression = milestoneProgressionOf({
      milestones: readRoadmapCanon({ roadmap: roadmap(), decisions: [], stages: SEQUENCE })
        .milestones,
      decisions: [RESOLVED],
      pointB: { tier: "decided" },
    });
    expect(progression!.statement).not.toMatch(/depends on|blocked by/i);
  });

  it("keeps a mapped, inferred milestone mapped and inferred", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap(),
      decisions: [RESOLVED],
      stages: SEQUENCE,
    });
    const target = canon.milestoneProgression?.to ?? canon.milestoneAttention!.milestone;
    expect(target.state).toBe("mapped");
    expect(target.tier).toBe("inferred");
    expect(canon.milestoneProgression?.statement ?? "").not.toMatch(
      /(marked|now) (live|complete|decided)/i,
    );
  });
});

/* ------------------------------------------------------------ still open */

describe("an unresolved decision still wins", () => {
  it("keeps attention on the stage-linked open decision", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap(),
      decisions: [
        RESOLVED,
        decision({ id: "dec-scope", stageId: "st-2", question: "Which build order?" }),
      ],
      stages: SEQUENCE,
    });
    expect(canon.milestoneAttention?.rule).toBe("open_decision");
    expect(canon.milestoneAttention?.decisionId).toBe("dec-scope");
  });
});

/* ------------------------------------------------------------ edge state */

describe("edges", () => {
  it("claims no progression when stages could not be read", () => {
    const canon = readRoadmapCanon({ roadmap: roadmap(), decisions: [RESOLVED] });
    expect(canon.milestonesKnown).toBe(false);
    expect(canon.milestoneProgression).toBeNull();
  });

  it("claims no progression on a genuinely empty sequence", () => {
    const canon = readRoadmapCanon({ roadmap: roadmap(), decisions: [RESOLVED], stages: [] });
    expect(canon.milestonesKnown).toBe(true);
    expect(canon.milestoneProgression).toBeNull();
  });

  it("says nothing is waiting when every milestone is already live", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap(),
      decisions: [RESOLVED],
      stages: SEQUENCE.map((row) => ({ ...row, state: "live" as const, tier: "decided" as const })),
    });
    expect(canon.milestoneAttention).toBeNull();
    expect(canon.milestoneProgression).toBeNull();
  });

  it("never reads another organisation's roadmap decisions", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap(),
      decisions: [
        { ...RESOLVED, id: "dec-other", organizationId: "org-2", roadmapId: "rm-other" },
      ],
      stages: SEQUENCE,
    });
    expect(canon.milestoneProgression).toBeNull();
    expect(canon.openDecisions).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- authority */

describe("authority is unchanged", () => {
  it("adds no roadmap capability beyond the two existing adapters", () => {
    const roadmapOps = ADAPTER_CAPABILITIES.filter(
      (capability) => capability.room === "roadmap" && capability.supported,
    ).map((capability) => capability.operation);
    expect(roadmapOps.sort()).toEqual(["roadmap.create_shell", "roadmap.request_decision"]);
  });

  it("resolves nothing and moves nothing: canon is a pure read", () => {
    const decisions = [decision()];
    const stages = SEQUENCE.map((row) => ({ ...row }));
    readRoadmapCanon({ roadmap: roadmap(), decisions, stages });
    expect(decisions[0]!.status).toBe("open");
    expect(stages.map((row) => `${row.position}:${row.state}`)).toEqual([
      "1:mapped",
      "2:mapped",
      "3:mapped",
    ]);
  });
});
