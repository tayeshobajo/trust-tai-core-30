import { describe, expect, it } from "vitest";
import {
  discoveryKey,
  discoveryReadiness,
  rawNotesOf,
  roadmapHandoffFor,
  type DiscoveryRecord,
} from "./discovery-intake";

const ORG = "org-fixture-0000-0000-0000-000000000001";
const CLIENT = "fixture-client-northwind";

function record(overrides: Partial<DiscoveryRecord> = {}): DiscoveryRecord {
  return {
    key: discoveryKey(ORG, CLIENT),
    organizationId: ORG,
    clientRef: CLIENT,
    desiredOutcome: {
      statement: "Monthly reporting the board trusts.",
      groundedIn: ["fixture-note-1"],
    },
    constraints: [
      { statement: "Timing: must land before the March audit.", groundedIn: ["fixture-note-1"] },
    ],
    stakeholders: [
      { label: "Fixture Finance Lead", role: "Signs off the format", groundedIn: ["fixture-note-1"] },
    ],
    unknowns: [{ topic: "budget", question: "What can they spend this year?" }],
    successMeasure: {
      statement: "The board stops asking for ad hoc numbers.",
      groundedIn: ["fixture-note-1"],
    },
    sources: [
      {
        sourceId: "fixture-note-1",
        label: "Discovery call note (synthetic)",
        occurredAt: "2026-02-02T10:00:00.000Z",
        rawText: "They said the board does not trust the current numbers.",
      },
    ],
    state: "approved",
    ownerUserId: "fixture-user-1",
    approvedBy: "fixture-user-2",
    approvedAt: "2026-02-03T09:00:00.000Z",
    ...overrides,
  };
}

describe("discovery readiness", () => {
  it("is ready when outcome, measure, people, sources and money and timing are settled or named", () => {
    expect(discoveryReadiness(record()).ready).toBe(true);
  });

  it("asks for the success measure when it is missing", () => {
    const readiness = discoveryReadiness(record({ successMeasure: null }));
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.join(" ")).toContain("judge whether it worked");
  });

  it("accepts an unknown budget only when the question is written down", () => {
    const readiness = discoveryReadiness(record({ unknowns: [] }));
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.join(" ")).toContain("Budget");
  });

  it("requires every captured line to name where it came from", () => {
    const readiness = discoveryReadiness(
      record({ desiredOutcome: { statement: "Something good.", groundedIn: [] } }),
    );
    expect(readiness.ready).toBe(false);
  });

  it("keeps the raw notes reachable and unchanged", () => {
    expect(rawNotesOf(record())[0]?.rawText).toContain("does not trust the current numbers");
  });
});

describe("roadmap handoff", () => {
  it("opens one roadmap with sources, open questions and an owner", () => {
    const handoff = roadmapHandoffFor({
      record: record(),
      by: { userId: "fixture-user-2" },
      at: "2026-02-03T10:00:00.000Z",
    });
    expect(handoff.opened).toBe(true);
    if (!handoff.opened) return;
    expect(handoff.opening.ownerUserId).toBe("fixture-user-1");
    expect(handoff.opening.sourceRefs).toHaveLength(1);
    expect(handoff.opening.unansweredQuestions).toEqual(["What can they spend this year?"]);
    expect(handoff.opening.objective).toContain("Monthly reporting");
  });

  it("opens nothing before a person approves the discovery", () => {
    const handoff = roadmapHandoffFor({
      record: record({ state: "ready_for_review", approvedBy: undefined }),
      by: { userId: "fixture-user-2" },
      at: "2026-02-03T10:00:00.000Z",
    });
    expect(handoff.opened).toBe(false);
  });

  it("opens nothing when the discovery is incomplete", () => {
    const handoff = roadmapHandoffFor({
      record: record({ successMeasure: null }),
      by: { userId: "fixture-user-2" },
      at: "2026-02-03T10:00:00.000Z",
    });
    expect(handoff.opened).toBe(false);
  });

  it("opens nothing without an owner", () => {
    const handoff = roadmapHandoffFor({
      record: record({ ownerUserId: undefined }),
      by: { userId: "fixture-user-2" },
      at: "2026-02-03T10:00:00.000Z",
    });
    expect(handoff.opened).toBe(false);
  });

  it("returns the first roadmap rather than opening a second", () => {
    const first = roadmapHandoffFor({
      record: record(),
      by: { userId: "fixture-user-2" },
      at: "2026-02-03T10:00:00.000Z",
    });
    expect(first.opened).toBe(true);
    if (!first.opened) return;
    const second = roadmapHandoffFor({
      record: record(),
      by: { userId: "fixture-user-2" },
      at: "2026-02-03T11:00:00.000Z",
      existingKeys: [first.opening.key],
    });
    expect(second.opened).toBe(false);
    expect("duplicate" in second && second.duplicate).toBe(true);
  });
});
