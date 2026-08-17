import { describe, expect, it } from "vitest";

import { checkTransition, nextStates, type ExecutionProject } from "./projects";

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "p1",
    organizationId: "o1",
    name: "Delivery",
    state: "not_started",
    pointA: "Nothing built yet.",
    pointB: "A working intake.",
    ownerLabel: "Tai",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" },
    lastMovedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("project state transitions", () => {
  it("refuses a jump straight from ready to delivered", () => {
    const check = checkTransition(project(), "delivered");
    expect(check.ok).toBe(false);
    expect(check.because).toContain("Not started");
  });

  it("allows ready to in flight when someone carries it", () => {
    expect(checkTransition(project(), "in_flight").ok).toBe(true);
  });

  it("refuses in flight when nobody carries it", () => {
    const unowned = { ...project(), ownerLabel: undefined };
    const check = checkTransition(unowned, "in_flight");
    expect(check.ok).toBe(false);
    expect(check.because).toContain("carries");
  });

  it("refuses a block with no reason", () => {
    expect(checkTransition(project(), "blocked").ok).toBe(false);
    expect(checkTransition(project(), "blocked", { blockedBecause: "Waiting on access" }).ok).toBe(
      true,
    );
  });

  it("refuses delivered with no agreed destination", () => {
    const check = checkTransition(project({ state: "in_flight", pointB: "  " }), "delivered");
    expect(check.ok).toBe(false);
  });

  it("does not let closed work move again", () => {
    expect(nextStates(project({ state: "closed" }))).toHaveLength(0);
    expect(checkTransition(project({ state: "closed" }), "in_flight").ok).toBe(false);
  });
});
