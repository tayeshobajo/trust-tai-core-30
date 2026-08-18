import { describe, expect, it } from "vitest";

import type { PulseSignal } from "@/domain/pulse";

import { canOpenInConductor, conductorHandoff, handoffQuestion, readHandoff } from "./handoff";

function pulseSignal(overrides: Partial<PulseSignal> & { id: string }): PulseSignal {
  return {
    organizationId: "org",
    severity: "act_now",
    category: "delivery",
    area: "delivery",
    title: "Unblock the work that stopped moving",
    summary: "1 project is blocked.",
    reason: "It has stood for 3 days.",
    sourceApp: "projects",
    sourceAppLabel: "Projects",
    entityPath: "Spartan Security › Houston Security Search Visibility",
    impact: "high",
    ageDays: 3,
    actionLabel: "Resolve blocker",
    actionRoute: "/modules/projects",
    evidence: [],
    confidence: "high",
    at: "2026-08-15T00:00:00.000Z",
    ...overrides,
  } as PulseSignal;
}

describe("pulse → conductor boundary", () => {
  it("carries only pointers, never business state", () => {
    const handoff = conductorHandoff(pulseSignal({ id: "projects:blocked:1" }));
    expect(Object.keys(handoff).sort()).toEqual(["app", "ask", "entity", "signal"]);
    expect(handoff.signal).toBe("projects:blocked:1");
    expect(handoff.app).toBe("projects");
  });

  it("asks a question specific to the signal and its lineage", () => {
    const question = handoffQuestion(pulseSignal({ id: "projects:blocked:1" }));
    expect(question).toContain("Unblock the work that stopped moving");
    expect(question).toContain("Spartan Security");
    expect(question).toContain("smallest next step");
  });

  it("asks for judgment, not action, on an Evaluate signal", () => {
    const question = handoffQuestion(
      pulseSignal({ id: "roadmap:decision:2", severity: "evaluate", sourceApp: "roadmap" }),
    );
    expect(question).toContain("decision");
  });

  it("opens for Projects, Comms, Roadmap and Scout signals", () => {
    for (const app of ["projects", "comms", "roadmap", "scout"]) {
      expect(canOpenInConductor({ sourceApp: app })).toBe(true);
    }
  });

  it("declines rooms with no governed read yet", () => {
    /* Ops now opens a read: the governed step (withdrawing this house's own
     * ask) lives in Projects, and the Ops gap is stated on the surface. */
    expect(canOpenInConductor({ sourceApp: "ops" })).toBe(true);
    expect(canOpenInConductor({ sourceApp: "activity" })).toBe(false);
  });

  it("round-trips through the URL", () => {
    const handoff = conductorHandoff(pulseSignal({ id: "comms:reply-debt:9", sourceApp: "comms" }));
    expect(readHandoff({ ...handoff })).toEqual(handoff);
  });

  it("treats a partial URL as no context at all", () => {
    expect(readHandoff({ signal: "x" })).toBeUndefined();
    expect(readHandoff({})).toBeUndefined();
  });
});
