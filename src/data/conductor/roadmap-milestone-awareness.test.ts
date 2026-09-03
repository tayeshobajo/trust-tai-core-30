/**
 * Conductor V3.3. Roadmap milestone awareness.
 *
 * Milestones are Roadmap's own stages, read, never re-modelled. What is proved:
 *  - stages read → milestonesKnown true, with provenance carried
 *  - stages unreadable → milestonesKnown false, nothing claimed
 *  - stages read and genuinely empty → milestonesKnown true
 *  - an unresolved decision on a stage outranks sequence
 *  - an undecided Point B puts the destination milestone first, as sequence
 *    logic, with no invented dependency
 *  - fallback is the earliest unfinished milestone, no dependency claimed
 *  - a mapped, inferred stage is never spoken of as decided
 *  - another organisation's stages never appear
 *  - authority, adapters and approval are unchanged
 */

import { describe, expect, it } from "vitest";

import { emptySnapshot, type SuiteSnapshot } from "@/data/intelligence/derive";
import {
  milestoneAttentionOf,
  planRoadmapCycle,
  readRoadmapCanon,
} from "@/data/intelligence/conductor/roadmap-cycle";
import { ADAPTER_CAPABILITIES } from "@/domain/adapter-registry";
import type { Roadmap, RoadmapDecision, RoadmapStage } from "@/domain/roadmap";

const ORG = "org-1";
const NOW = "2026-08-16T00:00:00.000Z";

function roadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: "rm-teamsynerg",
    organizationId: ORG,
    prospectId: "pros-teamsynerg",
    title: "Teamsynerg, path to be agreed",
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
      statement: "One operating system the team actually runs the week from",
      tier: "inferred",
      because: "Taken from what was entered when this roadmap was created.",
      evidence: [],
    },
    nextMove: {
      action: "Agree the destination",
      because: "Everything below assumes it.",
      tier: "inferred",
    },
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
    intent: "Confirm the operating system Teamsynerg is actually heading to",
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
    question:
      'Is "One operating system the team actually runs the week from" the right destination?',
    whyItMatters: "Everything sequenced below assumes this destination.",
    options: ["Approve as written", "Change the destination"],
    evidence: [],
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SuiteSnapshot> = {}): SuiteSnapshot {
  return { ...emptySnapshot(ORG, NOW), ...overrides };
}

const SEQUENCE = [
  stage(),
  stage({
    id: "st-2",
    position: 2,
    title: "Sequence the build",
    state: "mapped",
    tier: "inferred",
  }),
  stage({
    id: "st-3",
    position: 3,
    title: "Build the delivery board",
    state: "mapped",
    tier: "inferred",
  }),
];

/* ------------------------------------------------------------ known state */

describe("milestones known", () => {
  it("carries id, position, state, tier, owner and provenance", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap(),
      decisions: [],
      stages: [stage({ ownerLabel: "Tai" })],
    });
    expect(canon.milestonesKnown).toBe(true);
    const milestone = canon.milestones[0]!;
    expect(milestone.id).toBe("st-1");
    expect(milestone.roadmapId).toBe("rm-teamsynerg");
    expect(milestone.position).toBe(1);
    expect(milestone.state).toBe("mapped");
    expect(milestone.tier).toBe("inferred");
    expect(milestone.ownerLabel).toBe("Tai");
    expect(milestone.evidence[0]?.label).toContain("Discovery call");
  });

  it("stays unknown when stages could not be read", () => {
    const canon = readRoadmapCanon({ roadmap: roadmap(), decisions: [] });
    expect(canon.milestonesKnown).toBe(false);
    expect(canon.milestoneAttention).toBeNull();
    expect(canon.evidence.map((ref) => ref.label).join(" ")).toContain("could not be read");
  });

  it("is known, and empty, when the sequence genuinely has no stages", () => {
    const canon = readRoadmapCanon({ roadmap: roadmap(), decisions: [], stages: [] });
    expect(canon.milestonesKnown).toBe(true);
    expect(canon.milestones).toHaveLength(0);
    expect(canon.milestoneAttention).toBeNull();
  });

  it("never speaks of a mapped, inferred stage as decided", () => {
    const canon = readRoadmapCanon({ roadmap: roadmap(), decisions: [], stages: SEQUENCE });
    expect(canon.milestones.every((row) => row.tier === "inferred")).toBe(true);
    expect(canon.milestones.some((row) => row.state === "live")).toBe(false);
  });
});

/* --------------------------------------------------------------- attention */

describe("milestone attention rules", () => {
  it("puts an unresolved decision on a stage above sequence position", () => {
    const attention = milestoneAttentionOf({
      milestones: readRoadmapCanon({ roadmap: roadmap(), decisions: [], stages: SEQUENCE })
        .milestones,
      openDecisions: [decision({ id: "dec-board", stageId: "st-3" })],
      pointB: { tier: "decided" },
    })!;
    expect(attention.rule).toBe("open_decision");
    expect(attention.milestone.id).toBe("st-3");
    expect(attention.decisionId).toBe("dec-board");
  });

  it("puts the destination milestone first while Point B is undecided", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap(),
      decisions: [decision()],
      stages: SEQUENCE,
    });
    const attention = canon.milestoneAttention!;
    expect(attention.rule).toBe("destination_first");
    expect(attention.milestone.id).toBe("st-1");
    expect(attention.because).toContain("sequence logic");
    expect(attention.because).not.toContain("depends on");
  });

  it("falls back to the earliest unfinished milestone with no invented dependency", () => {
    const canon = readRoadmapCanon({
      roadmap: roadmap({
        pointB: { statement: "Agreed", tier: "decided", because: "Approved", evidence: [] },
      }),
      decisions: [],
      stages: [
        stage({ id: "st-1", position: 1, title: "Discovery", state: "live", tier: "decided" }),
        stage({ id: "st-2", position: 2, title: "Sequence the build" }),
        stage({ id: "st-3", position: 3, title: "Build the delivery board" }),
      ],
    });
    const attention = canon.milestoneAttention!;
    expect(attention.rule).toBe("sequence_position");
    expect(attention.milestone.id).toBe("st-2");
    expect(attention.because).toContain("No dependency is recorded");
  });
});

/* -------------------------------------------------------- bounded packet */

describe("reasoning packet", () => {
  it("includes stage provenance for the relevant roadmap only", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({
        roadmaps: [roadmap()],
        openDecisions: [decision()],
        roadmapStages: {
          "rm-teamsynerg": SEQUENCE,
          "rm-other": [stage({ id: "st-x", roadmapId: "rm-other" })],
        },
      }),
      question: "Where does the Teamsynerg roadmap stand?",
    });
    expect(cycle.canon?.milestonesKnown).toBe(true);
    expect(cycle.canon?.milestones.every((row) => row.roadmapId === "rm-teamsynerg")).toBe(true);
    expect(cycle.answer).toContain("milestones are sequenced");
    expect(cycle.answer).toContain("deserves attention next");
    expect(cycle.proposals).toHaveLength(0);
  });

  it("says milestones are unknown when the snapshot could not read them", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({
        roadmaps: [roadmap()],
        openDecisions: [decision()],
        roadmapStages: null,
      }),
      question: "Where does the Teamsynerg roadmap stand?",
    });
    expect(cycle.canon?.milestonesKnown).toBe(false);
    expect(cycle.answer).toContain("Milestones could not be read");
  });

  it("never carries another organisation's stages", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({
        roadmaps: [roadmap()],
        openDecisions: [],
        roadmapStages: {
          "rm-foreign": [stage({ id: "st-f", roadmapId: "rm-foreign", organizationId: "org-2" })],
        },
      }),
      question: "Where does the Teamsynerg roadmap stand?",
    });
    expect(cycle.canon?.milestones).toHaveLength(0);
    expect(cycle.canon?.milestonesKnown).toBe(true);
  });
});

/* --------------------------------------------------------------- authority */

describe("governance unchanged", () => {
  it("adds no adapter and still cannot resolve or reorder", () => {
    const resolve = ADAPTER_CAPABILITIES.find(
      (row) => row.operation === "roadmap.resolve_decision",
    );
    const sequencing = ADAPTER_CAPABILITIES.find(
      (row) => row.operation === "roadmap.change_sequencing",
    );
    expect(resolve?.supported).toBe(false);
    expect(sequencing?.supported).toBe(false);
  });

  it("proposes nothing merely because milestones became visible", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({
        roadmaps: [roadmap()],
        openDecisions: [],
        roadmapStages: { "rm-teamsynerg": SEQUENCE },
      }),
      question: "Where does the Teamsynerg roadmap stand?",
    });
    expect(cycle.proposals).toHaveLength(0);
  });
});
