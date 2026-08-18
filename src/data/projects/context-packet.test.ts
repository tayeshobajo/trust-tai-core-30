import { describe, expect, it } from "vitest";

import type { KnowledgeItem, ProjectAsset, ProjectConnection, ThinkingSource } from "@/domain/project-intelligence";
import type { ProjectBlocker, ProjectDecision, WorkItem } from "@/domain/project-delivery";
import type { ExecutionProject } from "@/domain/projects";

import { buildProjectContextPacket, contextHealth, type ContextPacketInput } from "./context-packet";
import { projectSuggestions } from "./suggestions";

const NOW = new Date("2026-03-10T09:00:00.000Z");

const project: ExecutionProject = {
  id: "p1",
  organizationId: "org1",
  name: "Northlight rebuild",
  state: "in_progress",
  pointA: "Site is dated",
  pointB: "A site that converts enquiries",
  ownerLabel: "Rosa",
  dueDate: "2026-04-01",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
} as ExecutionProject;

function knowledge(partial: Partial<KnowledgeItem> & Pick<KnowledgeItem, "section" | "body">): KnowledgeItem {
  return {
    id: partial.body,
    organizationId: "org1",
    projectId: "p1",
    origin: "human",
    reviewState: "confirmed",
    capturedAt: NOW.toISOString(),
    ...partial,
  } as KnowledgeItem;
}

function baseInput(overrides: Partial<ContextPacketInput> = {}): ContextPacketInput {
  return {
    project,
    knowledge: [],
    decisions: [],
    blockers: [],
    work: [],
    assets: [],
    connections: [],
    thinking: [],
    now: NOW,
    ...overrides,
  };
}

describe("project context packet", () => {
  it("puts an answered project decision above every other source", () => {
    const packet = buildProjectContextPacket(
      baseInput({
        decisions: [
          {
            id: "d1",
            organizationId: "org1",
            projectId: "p1",
            question: "Which checkout do we ship?",
            status: "answered",
            answer: "One page",
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
          } as ProjectDecision,
        ],
        knowledge: [knowledge({ section: "decision", body: "Two step checkout", origin: "thinking_room" })],
      }),
    );

    expect(packet.confirmedDecisions[0]?.authority).toBe("project_decision");
    expect(packet.confirmedDecisions[0]?.statement).toContain("One page");
  });

  it("excludes knowledge that has not been confirmed by a person", () => {
    const packet = buildProjectContextPacket(
      baseInput({
        knowledge: [
          knowledge({ section: "constraint", body: "Must ship before April", reviewState: "needs_review" }),
          knowledge({ section: "constraint", body: "Accessibility AA" }),
        ],
      }),
    );

    expect(packet.constraints.map((c) => c.statement)).toEqual(["Accessibility AA"]);
  });

  it("carries only approved assets and never a transcript", () => {
    const asset = (id: string, status: ProjectAsset["status"]): ProjectAsset => ({
      id,
      organizationId: "org1",
      projectId: "p1",
      fileId: `f-${id}`,
      assetType: "mockup",
      title: `Mockup ${id}`,
      version: 1,
      status,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const packet = buildProjectContextPacket(
      baseInput({ assets: [asset("a", "approved"), asset("b", "draft")] }),
    );

    expect(packet.approvedAssets).toHaveLength(1);
    expect(packet.approvedAssets[0]?.id).toBe("a");
  });

  it("reports conflicts rather than resolving them", () => {
    const packet = buildProjectContextPacket(
      baseInput({
        knowledge: [
          knowledge({
            section: "decision",
            body: "Ship one page checkout",
            sourceReference: "thread-9",
            sourceLabel: "Kickoff call",
          }),
          knowledge({
            section: "decision",
            body: "Ship two step checkout",
            origin: "thinking_room",
            sourceReference: "thread-9",
            sourceLabel: "Kickoff call",
          }),
        ],
      }),
    );

    expect(packet.conflicts.length).toBeGreaterThan(0);
    expect(packet.conflicts[0]?.about).toBe("Kickoff call");
  });

  it("shows the agent what it must not change when asked for on an agent's behalf", () => {
    const packet = buildProjectContextPacket(
      baseInput({
        knowledge: [knowledge({ section: "constraint", body: "No new dependencies" })],
        agent: {
          agentId: "builder",
          responsibility: "Implement approved work items",
          requiredContext: ["Approved mockup"],
          escalationRules: ["Escalate any scope change"],
          evidenceExpected: ["Pull request link"],
        },
      }),
    );

    expect(packet.agentBoundaries?.mustNotChange).toContain("No new dependencies");
  });
});

describe("context health", () => {
  it("is missing key context when nothing says what success is", () => {
    const packet = buildProjectContextPacket(
      baseInput({ project: { ...project, pointB: "", ownerLabel: undefined } as ExecutionProject }),
    );
    const health = contextHealth(packet);

    expect(health.level).toBe("missing_key_context");
    expect(health.reasons).toContain("No outcome is recorded.");
    expect(health.reasons).toContain("Nobody is named as owner.");
  });

  it("gives reasons, never a score, when review is needed", () => {
    const packet = buildProjectContextPacket(baseInput());
    const health = contextHealth(packet);

    expect(health.level).toBe("needs_review");
    expect(health.reasons.some((reason) => /%/.test(reason))).toBe(false);
  });

  it("is strong when outcome, owner, roadmap and decided truth are all on record", () => {
    const packet = buildProjectContextPacket(
      baseInput({
        roadmap: { roadmapId: "r1", milestoneId: "m1", milestoneName: "Milestone 02" },
        knowledge: [knowledge({ section: "decision", body: "Ship one page checkout", origin: "roadmap" })],
      }),
    );

    expect(contextHealth(packet).level).toBe("strong");
  });
});

describe("project suggestions", () => {
  const work = (title: string): WorkItem =>
    ({
      id: title,
      organizationId: "org1",
      projectId: "p1",
      title,
      status: "ready",
      sequence: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }) as WorkItem;

  it("only suggests what a condition in the record justifies", () => {
    const packet = buildProjectContextPacket(
      baseInput({ roadmap: { roadmapId: "r1" } }),
    );
    const suggestions = projectSuggestions({ packet, work: [], assets: [] });

    expect(suggestions.map((s) => s.id)).toEqual(["plan-the-work"]);
    expect(suggestions[0]?.evidence).toContain("0 work items");
  });

  it("asks whether an approval still stands when a newer asset arrives", () => {
    const assets: ProjectAsset[] = [
      {
        id: "a",
        organizationId: "org1",
        projectId: "p1",
        fileId: "f1",
        assetType: "mockup",
        title: "Home v1",
        version: 1,
        status: "approved",
        createdAt: "2026-03-01T09:00:00.000Z",
        updatedAt: "2026-03-01T09:00:00.000Z",
      },
      {
        id: "b",
        organizationId: "org1",
        projectId: "p1",
        fileId: "f2",
        assetType: "mockup",
        title: "Home v2",
        version: 2,
        status: "draft",
        createdAt: "2026-03-05T09:00:00.000Z",
        updatedAt: "2026-03-05T09:00:00.000Z",
      },
    ];
    const packet = buildProjectContextPacket(baseInput({ assets, roadmap: { roadmapId: "r1" } }));
    const ids = projectSuggestions({ packet, work: [work("Build QA pass")], assets }).map((s) => s.id);

    expect(ids).toContain("review-approval-a");
  });

  it("respects a dismissal", () => {
    const packet = buildProjectContextPacket(baseInput({ roadmap: { roadmapId: "r1" } }));
    const suggestions = projectSuggestions({
      packet,
      work: [],
      assets: [],
      dismissed: ["plan-the-work"],
    });

    expect(suggestions).toEqual([]);
  });
});
