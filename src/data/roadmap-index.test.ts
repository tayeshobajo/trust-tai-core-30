import { describe, expect, it } from "vitest";

import { buildRoadmapRow, filterRoadmapRows, readyFromScout, roadmapGlance } from "./roadmap-index";
import type { Roadmap, RoadmapDecision, RoadmapStage } from "@/domain/roadmap";

const now = "2026-01-01T00:00:00.000Z";

function roadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: "r1",
    organizationId: "org",
    title: "Elevate",
    subjectLabel: "Elevate Orthodontics",
    objective: "Grow",
    status: "in_progress",
    pointA: [
      { label: "Point A", value: "Referral dependent", tier: "observed", evidence: [], at: now },
    ],
    pointB: { statement: "Stronger acquisition", tier: "inferred", because: "", evidence: [] },
    nextMove: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function stage(id: string, position: number, state: RoadmapStage["state"]): RoadmapStage {
  return {
    id,
    organizationId: "org",
    roadmapId: "r1",
    position,
    title: `Stage ${position}`,
    state,
    tier: "inferred",
    evidence: [],
    createdAt: now,
    updatedAt: now,
  };
}

function decision(overrides: Partial<RoadmapDecision> = {}): RoadmapDecision {
  return {
    id: "d1",
    organizationId: "org",
    roadmapId: "r1",
    question: "Is this the right destination?",
    whyItMatters: "Everything below assumes it.",
    options: [],
    evidence: [],
    status: "open",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("roadmap index read models", () => {
  it("marks the in-build stage as current and keeps the sequence", () => {
    const row = buildRoadmapRow(
      roadmap(),
      [stage("a", 1, "live"), stage("b", 2, "in_build"), stage("c", 3, "mapped")],
      [],
    );
    expect(row.milestones.map((m) => m.state)).toEqual(["done", "current", "future"]);
    expect(row.current?.id).toBe("b");
    expect(row.next).toBeNull();
  });

  it("falls back to the next mapped milestone when nothing is in build", () => {
    const row = buildRoadmapRow(roadmap(), [stage("a", 1, "mapped")], []);
    expect(row.current).toBeNull();
    expect(row.next?.id).toBe("a");
  });

  it("labels an unapproved destination as inferred", () => {
    expect(buildRoadmapRow(roadmap(), [], []).pointBTier).toBe("inferred");
  });

  it("shows needs decision above the internal status", () => {
    const row = buildRoadmapRow(roadmap(), [], [decision()]);
    expect(row.state).toBe("needs_decision");
    expect(row.openDecisions).toHaveLength(1);
  });

  it("maps draft and complete states into user language", () => {
    expect(buildRoadmapRow(roadmap({ status: "draft" }), [], []).state).toBe("draft");
    expect(buildRoadmapRow(roadmap({ status: "archived" }), [], []).state).toBe("complete");
  });

  it("counts only three things", () => {
    const rows = [
      buildRoadmapRow(roadmap(), [stage("b", 2, "in_build")], [decision()]),
      buildRoadmapRow(roadmap({ id: "r2", status: "complete" }), [], []),
    ];
    expect(roadmapGlance(rows)).toEqual({
      activeRoadmaps: 1,
      needsDecision: 1,
      milestonesInMotion: 1,
    });
  });

  it("filters by search and state", () => {
    const rows = [buildRoadmapRow(roadmap(), [], [])];
    expect(filterRoadmapRows(rows, "elevate", "all")).toHaveLength(1);
    expect(filterRoadmapRows(rows, "nothing", "all")).toHaveLength(0);
    expect(filterRoadmapRows(rows, "", "draft")).toHaveLength(0);
  });

  it("never offers a second roadmap for a company that already has one", () => {
    const candidate = (id: string, status: string, score: number) =>
      ({
        prospect: { id, name: id, status, domain: "", websiteUrl: "" },
        evaluation: { score },
      }) as never;
    const list = readyFromScout(
      [
        candidate("p1", "qualified", 80),
        candidate("p2", "qualified", 90),
        candidate("p3", "discovered", 99),
      ],
      [roadmap({ prospectId: "p1" })],
    );
    expect(list.map((c) => c.prospect.id)).toEqual(["p2"]);
  });
});
