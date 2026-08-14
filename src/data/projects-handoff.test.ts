import { describe, expect, it } from "vitest";

import { projectFromMilestone } from "@/data/projects-handoff";
import { projectHealth, recommendedMove, type ExecutionProject } from "@/domain/projects";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";

function milestone(overrides: Partial<RoadmapMilestone> = {}): RoadmapMilestone {
  return {
    id: "m1",
    organizationId: "org",
    roadmapId: "r1",
    name: "Booking flow",
    whatWeBuild: "A self-serve booking flow on the marketing site.",
    intendedUser: "Operations managers",
    supportingMarketDirection: "Buyers book without a call.",
    clientAdvantage: "They already own the traffic.",
    currentGap: "Every booking goes through email today.",
    evidence: [{ label: "Pricing page", url: "https://example.com/pricing" }],
    immediateValue: "Bookings stop dying in the inbox.",
    longTermValue: "Compounding self-serve revenue.",
    dependencies: [],
    executionBoundary: "No payment processing in v1.",
    confidence: "moderate",
    priorityScore: 80,
    priorityRationale: [],
    recommendedSequence: 1,
    status: "approved",
    tier: "decided",
    ownerLabel: "Tai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as RoadmapMilestone;
}

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "p1",
    organizationId: "org",
    name: "Booking flow",
    state: "in_flight",
    pointA: "Bookings go through email.",
    pointB: "Self-serve booking flow.",
    nextMove: "Ship the availability screen.",
    ownerLabel: "Tai",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" },
    lastMovedAt: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectFromMilestone", () => {
  it("carries a decided milestone across with its evidence and origin", () => {
    const result = projectFromMilestone(milestone(), "TeamsynerG");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.pointB).toContain("booking flow");
    expect(result.input.origin).toMatchObject({ kind: "roadmap_milestone", milestoneId: "m1" });
    expect(result.input.evidence?.[0]?.kind).toBe("page");
  });

  it("refuses a proposal that no person has decided", () => {
    const result = projectFromMilestone(milestone({ status: "candidate" }), "TeamsynerG");
    expect(result).toEqual({ ok: false, because: "Not approved by a person yet." });
  });

  it("refuses while a dependency is still open", () => {
    const result = projectFromMilestone(milestone({ dependencies: ["Brand refresh"] }), "X");
    expect(result.ok).toBe(false);
  });
});

describe("projectHealth and recommendedMove", () => {
  const now = new Date("2026-02-05T00:00:00.000Z");

  it("reads owned, moving work as on track", () => {
    expect(projectHealth(project(), now).level).toBe("on_track");
    expect(recommendedMove(project(), now).move).toBe("Ship the availability screen.");
  });

  it("names a block rather than guessing", () => {
    const blocked = project({ state: "blocked", blockedBecause: "Waiting on brand assets." });
    expect(projectHealth(blocked, now).level).toBe("at_risk");
    expect(recommendedMove(blocked, now).move).toContain("Waiting on brand assets.");
  });

  it("calls out silence as risk", () => {
    const stale = project({ lastMovedAt: "2026-01-01T00:00:00.000Z" });
    expect(projectHealth(stale, now).level).toBe("at_risk");
    expect(projectHealth(stale, now).because).toContain("35 days");
  });

  it("asks for an owner before anything else", () => {
    const orphan = project({ ownerLabel: undefined as unknown as string });
    expect(recommendedMove(orphan, now).move).toBe("Name who carries this.");
  });
});
