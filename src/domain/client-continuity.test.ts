import { describe, expect, it } from "vitest";

import { clientContinuity, type ContinuityLine } from "@/domain/client-continuity";
import { answered, unreadable, type RoadmapOutcome } from "@/domain/client-shell";
import type { ExecutionProject } from "@/domain/projects";

const CLIENT = "client-fixture-0000-0000-0000-000000000001";
const ORG = "org-fixture-0000-0000-0000-000000000001";

function outcome(over: Partial<RoadmapOutcome> = {}): RoadmapOutcome {
  return {
    roadmapId: "roadmap-1",
    title: "Growth roadmap",
    statusLabel: "Active",
    active: true,
    destination: "Double qualified enquiries by the end of the year",
    destinationTier: "decided",
    milestone: "Launch the new enquiry page",
    milestoneStateLabel: "In build",
    milestoneBlocked: false,
    nextMove: "Confirm the copy with the client",
    openDecisions: 0,
    stagesLive: 1,
    stagesTotal: 4,
    ...over,
  };
}

function project(over: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "project-1",
    organizationId: ORG,
    name: "Enquiry page build",
    state: "in_flight",
    clientId: CLIENT,
    pointA: "The old page converts badly.",
    pointB: "A page that qualifies enquiries.",
    ownerLabel: "Person One",
    ...over,
  } as ExecutionProject;
}

function line(lines: ContinuityLine[], id: ContinuityLine["id"]): ContinuityLine {
  const found = lines.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("clientContinuity", () => {
  it("answers the same six questions in the same order", () => {
    const lines = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(outcome()),
      projects: answered([project()]),
    });
    expect(lines.map((entry) => entry.id)).toEqual([
      "stage",
      "outcome",
      "next_action",
      "owner",
      "blocker",
      "scope_version",
    ]);
  });

  it("links every roadmap answer back to the roadmap it came from", () => {
    const lines = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(outcome()),
      projects: answered([project()]),
    });
    expect(line(lines, "stage").evidenceHref).toBe("/modules/roadmap/roadmap-1");
    expect(line(lines, "outcome").evidenceLabel).toBe("Growth roadmap");
  });

  it("calls an unapproved destination inferred, never agreed", () => {
    const lines = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(outcome({ destinationTier: "inferred" })),
      projects: answered([]),
    });
    expect(line(lines, "outcome").certainty).toBe("inferred");
  });

  it("keeps a failed read distinct from nothing recorded", () => {
    const failed = clientContinuity({
      clientId: CLIENT,
      roadmap: unreadable("Roadmap could not be read."),
      projects: answered([]),
    });
    expect(line(failed, "stage").certainty).toBe("unreadable");

    const empty = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(null),
      projects: answered([]),
    });
    expect(line(empty, "stage").certainty).toBe("not_recorded");
  });

  it("names a blocked milestone as the blocker", () => {
    const lines = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(outcome({ milestoneBlocked: true })),
      projects: answered([]),
    });
    expect(line(lines, "blocker").value).toContain("is blocked");
  });

  it("reports waiting decisions when nothing is blocked", () => {
    const lines = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(outcome({ openDecisions: 2 })),
      projects: answered([]),
    });
    expect(line(lines, "blocker").value).toBe("2 decisions are waiting on a person");
  });

  it("says when open work has nobody holding it", () => {
    const lines = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(outcome()),
      projects: answered([project({ ownerLabel: "  " })]),
    });
    expect(line(lines, "owner").value).toBe("Open work has no named owner");
    expect(line(lines, "owner").certainty).toBe("not_recorded");
  });

  it("does not claim an owner when delivery could not be read", () => {
    const lines = clientContinuity({
      clientId: CLIENT,
      roadmap: answered(outcome()),
      projects: unreadable("Projects could not be read."),
    });
    expect(line(lines, "owner").certainty).toBe("unreadable");
  });
});
