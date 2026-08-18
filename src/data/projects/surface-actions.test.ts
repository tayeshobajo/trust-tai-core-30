import { describe, expect, it } from "vitest";

import type { ExecutionProject } from "@/domain/projects";

import { changesForSurface, surfaceActions } from "./surface-actions";

const NOW = new Date().toISOString();

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "p1",
    organizationId: "org",
    name: "Delivery",
    state: "in_flight",
    ownerLabel: "Tai",
    pointA: "Nothing shipped yet.",
    pointB: "Client can run it themselves.",
    nextMove: "Agree scope",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" },
    lastMovedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function action(p: ExecutionProject, target: string, reason = "") {
  return surfaceActions(p, reason).find((entry) => entry.target === target)!;
}

describe("surfaceActions", () => {
  it("marks the current status and refuses to move there again", () => {
    const current = action(project(), "in_progress");
    expect(current.current).toBe(true);
    expect(current.ok).toBe(false);
  });

  it("refuses Blocked until a reason is given", () => {
    expect(action(project(), "blocked").ok).toBe(false);
    expect(action(project(), "blocked", "Waiting on API keys").ok).toBe(true);
  });

  it("refuses Waiting until it says what it waits on", () => {
    expect(action(project(), "waiting").ok).toBe(false);
    expect(action(project(), "waiting", "Client sign-off").ok).toBe(true);
  });

  it("refuses In progress when nobody carries the work", () => {
    const orphan = project({ state: "not_started", ownerLabel: "" });
    const move = action(orphan, "in_progress");
    expect(move.ok).toBe(false);
    expect(move.because).toMatch(/carries/i);
  });

  it("refuses Complete when there is no agreed outcome", () => {
    const move = action(project({ pointB: "  " }), "complete");
    expect(move.ok).toBe(false);
  });

  it("lets waiting work return to in progress without a reason", () => {
    const waiting = project({ waitingOn: "Client sign-off" });
    const move = action(waiting, "in_progress");
    expect(move.ok).toBe(true);
    expect(changesForSurface("in_progress").waitingOn).toBe("");
  });

  it("refuses every move once the work is closed", () => {
    const closed = project({ state: "closed" });
    expect(surfaceActions(closed, "reason").filter((entry) => entry.ok)).toHaveLength(0);
  });

  it("writes the reason onto the right field", () => {
    expect(changesForSurface("blocked", " no access ")).toEqual({
      state: "blocked",
      blockedBecause: "no access",
    });
    expect(changesForSurface("waiting", "legal")).toEqual({
      state: "in_flight",
      waitingOn: "legal",
    });
  });
});
