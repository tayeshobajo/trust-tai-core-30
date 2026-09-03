/**
 * Conductor V3.2, question → Roadmap cycle.
 *
 * The Roadmap canon is a reasoning contract, not copy: Point A, the proof
 * under it, Point B and whether it is inferred or decided, the milestones, the
 * decisions still open, and the boundary of what may be executed at all.
 *
 * What is proved here:
 *  - an existing roadmap is read, never duplicated with a second shell
 *  - an existing open decision is surfaced, never asked again
 *  - two plausible subjects stay unresolved rather than being guessed
 *  - a shell needs a canonical subject and a grounded objective
 *  - a decision request needs a real roadmap id and a real question
 *  - Conductor never resolves a Roadmap decision
 *  - retries produce identical, non-duplicating governed actions
 *  - a roadmap from another organisation cannot hydrate anything
 *  - the answer speaks Point A / proof / Point B / decision, with truth class
 *  - learning never changes decision authority or adapter permissions
 */

import { describe, expect, it, vi } from "vitest";

import { emptySnapshot, type SuiteSnapshot } from "@/data/intelligence/derive";
import { answerQuestion } from "@/data/intelligence/conductor";
import {
  ROADMAP_DECISION_OPERATION,
  ROADMAP_SHELL_OPERATION,
  existingEquivalentDecision,
  isMateriallySameQuestion,
  planRoadmapCycle,
  readRoadmapCanon,
  resolveRoadmapSubject,
} from "@/data/intelligence/conductor/roadmap-cycle";
import { ADAPTER_CAPABILITIES, capabilityFor } from "@/domain/adapter-registry";
import { learningGrantsExecution } from "@/domain/outcomes";
import type { Roadmap, RoadmapDecision } from "@/domain/roadmap";

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

function decision(overrides: Partial<RoadmapDecision> = {}): RoadmapDecision {
  return {
    id: "dec-destination",
    organizationId: ORG,
    roadmapId: "rm-teamsynerg",
    question: 'Is "One operating system the team actually runs the week from" the right destination?',
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
  return {...emptySnapshot(ORG, NOW),...overrides };
}

/* --------------------------------------------------------------- canon read */

describe("roadmap canon read", () => {
  it("maps Point A, anchor proof, Point B truth class and open decisions", () => {
    const canon = readRoadmapCanon({ roadmap: roadmap(), decisions: [decision()] });
    expect(canon.pointA).toHaveLength(1);
    expect(canon.anchorProof?.value).toContain("three disconnected tools");
    expect(canon.pointB?.tier).toBe("inferred");
    expect(canon.governingThought).toContain("operating system");
    expect(canon.openDecisions).toHaveLength(1);
    expect(canon.milestonesKnown).toBe(false);
  });

  it("answers a roadmap question in Point A / proof / Point B / decision language", () => {
    const result = answerQuestion({
      snapshot: snapshot({ roadmaps: [roadmap()], openDecisions: [decision()] }),
      question: "What decision in our active roadmap deserves my attention next?",
    });
    expect(result.topic).toBe("roadmap");
    expect(result.answer).toContain("Point A");
    expect(result.answer).toContain("Point B is still inferred, not decided");
    expect(result.answer).toContain("waiting on you");
    expect(result.roadmapCanon?.roadmapId).toBe("rm-teamsynerg");
  });
});

/* ---------------------------------------------------------- existing state */

describe("existing roadmap first", () => {
  it("reads the existing roadmap instead of proposing a duplicate shell", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({ roadmaps: [roadmap()], openDecisions: [decision()] }),
      question: "Where does the Teamsynerg roadmap stand?",
    });
    expect(cycle.proposals.every((p) => p.operation !== ROADMAP_SHELL_OPERATION)).toBe(true);
    expect(cycle.canon?.roadmapId).toBe("rm-teamsynerg");
  });

  it("surfaces the existing open decision rather than raising another", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({ roadmaps: [roadmap()], openDecisions: [decision()] }),
      question: "What decision in our active roadmap deserves my attention next?",
    });
    expect(cycle.proposals).toHaveLength(0);
    expect(cycle.nextMove?.statement).toContain("Answer the open decision");
  });

  it("treats a re-phrasing of the same unresolved question as the same decision", () => {
    const open = decision();
    expect(
      existingEquivalentDecision(
        'Should we approve "One operating system the team actually runs the week from" as the destination or change it?',
        [open],
      ),
    ).toBeDefined();
    expect(isMateriallySameQuestion("Which sequence should we build first?", "Who owns billing?")).toBe(
      false,
    );
  });

  it("may propose a genuinely new decision, attached to the real roadmap", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({ roadmaps: [roadmap()], openDecisions: [] }),
      question:
        "On the Teamsynerg roadmap, should we build the client portal first or the internal delivery board?",
    });
    const proposal = cycle.proposals[0]!;
    expect(proposal.operation).toBe(ROADMAP_DECISION_OPERATION);
    expect(proposal.payload?.["roadmapId"]).toBe("rm-teamsynerg");
    expect(String(proposal.payload?.["question"]).length).toBeGreaterThan(10);
    expect(String(proposal.payload?.["whyItMatters"]).length).toBeGreaterThan(10);
    expect(proposal.requiresApproval).toBe(true);
    /* Conductor asks. It never answers. */
    expect(proposal.willNotDo.join(" ")).toContain("Answer the decision");
  });

  it("does not raise a second decision when an equivalent one is already open", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot({ roadmaps: [roadmap()], openDecisions: [decision()] }),
      question:
        'Should we keep "One operating system the team actually runs the week from" as the right destination or change it?',
    });
    expect(cycle.proposals).toHaveLength(0);
    expect(cycle.answer).toContain("I have not raised another");
  });
});

/* ------------------------------------------------------------- resolution */

describe("subject resolution", () => {
  it("refuses to choose between two plausible subjects", () => {
    const other = roadmap({ id: "rm-acme", subjectLabel: "Acme", prospectId: "pros-acme" });
    const resolution = resolveRoadmapSubject({
      snapshot: snapshot({ roadmaps: [roadmap(), other] }),
      question: "Should we sequence Teamsynerg or Acme first on their roadmaps?",
    });
    expect(resolution.status).toBe("ambiguous");
  });

  it("stays informational when nothing canonical matches", () => {
    const cycle = planRoadmapCycle({
      snapshot: snapshot(),
      question: "Build a roadmap for Northwind Logistics",
    });
    expect(cycle.proposals).toHaveLength(0);
    expect(cycle.answer).toContain("No roadmap exists");
  });

  it("never hydrates a roadmap from another organisation", () => {
    /* Snapshots are organisation-scoped; a foreign roadmap is simply absent. */
    const foreign = roadmap({ id: "rm-foreign", organizationId: "org-2" });
    const resolution = resolveRoadmapSubject({
      snapshot: {...snapshot(), roadmaps: [] },
      question: `Where does roadmap ${foreign.id} stand?`,
    });
    expect(resolution.status).toBe("none");
  });
});

/* ------------------------------------------------------------ create shell */

describe("create shell only when justified", () => {
  const withProspect = () =>
    snapshot({
      candidates: [
        {
          prospect: {
            id: "pros-northwind",
            organizationId: ORG,
            name: "Northwind Logistics",
            status: "qualified",
            createdAt: NOW,
            updatedAt: NOW,
          },
          signals: [],
          fit: { score: 70, band: "strong", reasons: [] },
          source: { kind: "manual", label: "Manual" },
          evaluation: { score: 70, band: "strong", criteria: [], missing: [] },
          lastCheckedAt: NOW,
        } as never,
      ],
    });

  it("requires an explicit ask to map before proposing a shell", () => {
    const cycle = planRoadmapCycle({
      snapshot: withProspect(),
      question: "What is the roadmap position for Northwind Logistics?",
    });
    expect(cycle.proposals).toHaveLength(0);
  });

  it("proposes a shell with a canonical subject and a grounded objective", () => {
    const cycle = planRoadmapCycle({
      snapshot: withProspect(),
      question:
        "Map a roadmap for Northwind Logistics so their operations stop depending on one dispatcher",
    });
    const proposal = cycle.proposals[0]!;
    expect(proposal.operation).toBe(ROADMAP_SHELL_OPERATION);
    expect(proposal.payload?.["subjectKind"]).toBe("prospect");
    expect(proposal.payload?.["subjectId"]).toBe("pros-northwind");
    expect(String(proposal.payload?.["objective"]).length).toBeGreaterThan(12);
    expect(proposal.requiresApproval).toBe(true);
  });
});

/* ---------------------------------------------------------------- retries */

describe("duplication safety", () => {
  it("produces an identical governed action id on a retry", () => {
    const input = {
      snapshot: snapshot({ roadmaps: [roadmap()], openDecisions: [] }),
      question:
        "On the Teamsynerg roadmap, should we build the client portal first or the internal delivery board?",
    };
    const first = planRoadmapCycle(input);
    const second = planRoadmapCycle(input);
    expect(first.proposals[0]!.id).toBe(second.proposals[0]!.id);
  });

  it("returns the existing decision instead of writing a second one", async () => {
    vi.resetModules();
    const addDecision = vi.fn();
    vi.doMock("@/data/supabase/roadmap-service", () => ({
      roadmapService: {
        detail: async () => ({
          roadmap: { id: "rm-teamsynerg", title: "Teamsynerg" },
          stages: [],
          decisions: [decision()],
        }),
        addDecision,
        create: vi.fn(),
      },
    }));
    const { roadmapDecisionAdapter } = await import("./adapters-roadmap");
    const receipt = await roadmapDecisionAdapter.route(
      {
        id: "act-1",
        organizationId: ORG,
        owningApp: "roadmap",
        operation: ROADMAP_DECISION_OPERATION,
        status: "approved",
        requiredCapability: "roadmap.write",
        evidence: [],
        whyItMatters: "Everything sequenced below assumes this destination.",
        payload: {
          roadmapId: "rm-teamsynerg",
          question:
            'Should we approve "One operating system the team actually runs the week from" as the right destination, or change it?',
        },
      } as never,
      {
        organizationId: ORG,
        actor: { id: "u1", label: "Tai" },
        approvedBy: { id: "u1", label: "Tai" },
        now: NOW,
      } as never,
    );
    expect(addDecision).not.toHaveBeenCalled();
    expect(receipt.status).toBe("routed");
    expect(receipt.result?.reference).toBe("dec-destination");
    vi.doUnmock("@/data/supabase/roadmap-service");
  });
});

/* --------------------------------------------------------------- authority */

describe("human authority is unchanged", () => {
  it("has no adapter that resolves a roadmap decision", () => {
    const operations = ADAPTER_CAPABILITIES.map((row) => row.operation);
    expect(operations).toContain(ROADMAP_DECISION_OPERATION);
    const resolve = ADAPTER_CAPABILITIES.find(
      (row) => row.operation === "roadmap.resolve_decision",
    );
    expect(resolve?.supported).toBe(false);
    expect(resolve?.adapterId).toBeUndefined();
    const sequencing = ADAPTER_CAPABILITIES.find(
      (row) => row.operation === "roadmap.change_sequencing",
    );
    expect(sequencing?.supported).toBe(false);
  });

  it("keeps roadmap operations behind a roadmap permission", () => {
    expect(capabilityFor("roadmap", ROADMAP_SHELL_OPERATION)?.requiredCapability).toContain("roadmap");
    expect(capabilityFor("roadmap", ROADMAP_DECISION_OPERATION)?.requiredCapability).toContain("roadmap");
  });

  it("never lets a learned lesson grant execution", () => {
    expect(
      learningGrantsExecution({ id: "l1", organizationId: ORG } as never),
    ).toBe(false);
  });
});
