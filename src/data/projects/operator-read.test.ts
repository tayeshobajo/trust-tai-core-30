import { describe, expect, it } from "vitest";

import type { RuntimeRead } from "@/domain/intelligence-runtime";

import type { ProjectContextPacket } from "./context-packet";
import {
  foldOperatorRead,
  operatorEvidenceFromPacket,
  operatorReadRequestFor,
} from "./operator-read";

const NOW = "2026-08-22T10:00:00.000Z";

function packet(overrides: Partial<ProjectContextPacket> = {}): ProjectContextPacket {
  return {
    generatedAt: NOW,
    project: {
      id: "proj-1",
      organizationId: "org-1",
      name: "Website Growth Sprint",
      company: "Acme",
      state: "active",
      outcome: "Ship the new site",
    },
    roadmap: { linked: true, roadmapId: "rm-1", milestoneId: "ms-1", milestoneName: "Launch" },
    confirmedDecisions: [
      { statement: "The launch date is 2026-09-15.", authority: "project_decision" },
    ],
    constraints: [],
    openQuestions: [{ statement: "Who signs off the final copy?", authority: "meeting" }],
    requirements: [],
    activeBlockers: [{ reason: "Final copy not delivered", owner: "client", raisedAt: NOW }],
    currentWork: [
      { id: "w1", title: "Homepage build", status: "in_progress", owner: "Tai" },
    ],
    approvedAssets: [],
    connectedSystems: [],
    meetingContext: [],
    thinkingSources: [],
    ...overrides,
  } as ProjectContextPacket;
}

function read(overrides: Partial<RuntimeRead> = {}): RuntimeRead {
  return {
    room: "projects",
    objective: "operator read",
    facts: [],
    interpretations: [],
    knowledge: [],
    unknowns: [],
    nextSteps: [],
    confidence: "moderate",
    verification: [
      {
        claim: "The launch checklist is complete.",
        evidenceKind: "acceptance_criterion",
        description: "Each criterion is checked and recorded.",
      },
    ],
    provenance: { evidenceRefs: [], knowledgeRefs: [], withheld: [] },
    reasonedByModel: true,
    generatedAt: NOW,
    ...overrides,
  };
}

describe("operatorEvidenceFromPacket", () => {
  it("keeps provenance tiers: decisions decided, blockers and work derived", () => {
    const evidence = operatorEvidenceFromPacket(packet());
    const decision = evidence.find((item) => item.id.includes(":decision:"));
    const blocker = evidence.find((item) => item.id.includes(":blocker:"));
    const work = evidence.find((item) => item.id.includes(":work:"));
    expect(decision?.tier).toBe("decided");
    expect(blocker?.tier).toBe("derived");
    expect(blocker?.statement).toContain("Final copy not delivered");
    expect(work?.tier).toBe("derived");
    expect(work?.statement).toContain("Homepage build");
  });
});

describe("operatorReadRequestFor", () => {
  it("asks the operator question inside the approval boundary", () => {
    const req = operatorReadRequestFor({
      packet: packet(),
      milestoneId: "ms-1",
      milestoneName: "Launch",
      organizationId: "org-1",
      now: NOW,
    });
    expect(req.room).toBe("projects");
    expect(req.output).toBe("operator_read");
    expect(req.approval.required).toBe(true);
    expect(req.approval.permission).toBe("projects.write");
    expect(req.objective).toContain("Launch");
    expect(req.objective).toContain("Website Growth Sprint");
    expect(req.verification.kind).toBe("acceptance_criterion");
    expect(req.evidence.length).toBeGreaterThan(0);
  });
});

describe("foldOperatorRead", () => {
  it("turns open questions into missing context and clarifying questions", () => {
    const folded = foldOperatorRead({ read: read(), packet: packet(), milestoneId: "ms-1" });
    expect(folded.missingContext.some((gap) => gap.missing.includes("final copy"))).toBe(true);
    expect(folded.clarifyingQuestions).toContain("Who signs off the final copy?");
  });

  it("carries the verification plan into proposed acceptance criteria", () => {
    const folded = foldOperatorRead({ read: read(), packet: packet(), milestoneId: "ms-1" });
    expect(folded.proposedAcceptanceCriteria).toEqual([
      { criterion: "The launch checklist is complete.", evidenceKind: "acceptance_criterion" },
    ]);
  });

  it("surfaces active blockers as risks with evidence refs", () => {
    const folded = foldOperatorRead({ read: read(), packet: packet(), milestoneId: "ms-1" });
    const risk = folded.risks.find((row) => row.risk.includes("Final copy"));
    expect(risk).toBeDefined();
    expect(risk!.restsOn[0]).toContain(":blocker:");
  });

  it("marks external next steps as capability gaps a person carries", () => {
    const folded = foldOperatorRead({
      read: read({
        nextSteps: [
          {
            title: "Chase the client for copy",
            owningRoom: "comms",
            requiresApproval: true,
            willDo: [],
            willNotDo: [],
            reversible: true,
            external: true,
          },
        ],
      }),
      packet: packet(),
      milestoneId: "ms-1",
    });
    expect(folded.capabilityFit.gaps[0]).toContain("Chase the client for copy");
  });

  it("requires clarification when the packet holds no decisions or requirements", () => {
    const thin = packet({ confirmedDecisions: [], requirements: [] });
    const folded = foldOperatorRead({ read: read(), packet: thin, milestoneId: "ms-1" });
    expect(folded.clarificationRequired).toBe(true);
  });

  it("does not require clarification when the packet is grounded", () => {
    const grounded = packet({
      requirements: [
        { statement: "The site must load in under two seconds.", authority: "project_decision" },
      ],
    });
    const folded = foldOperatorRead({
      read: read({ confidence: "moderate" }),
      packet: grounded,
      milestoneId: "ms-1",
    });
    expect(folded.clarificationRequired).toBe(false);
  });
});
