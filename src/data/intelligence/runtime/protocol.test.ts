import { describe, expect, it } from "vitest";

import type { ProtocolAttempt } from "@/domain/intelligence-runtime";

import { MAX_DIAGNOSTIC_ATTEMPTS, nextProtocolStep, type DiagnosticContext } from "./protocol";

function context(overrides: Partial<DiagnosticContext> = {}): DiagnosticContext {
  return {
    objective: "Prepare the milestone for execution",
    unknowns: [],
    inspectionsAvailable: [],
    safeTests: [],
    ...overrides,
  };
}

function failed(action: string): ProtocolAttempt {
  return { stage: "test_safely", action, outcome: "failed" };
}

describe("nextProtocolStep", () => {
  it("starts by inspecting the objective", () => {
    const next = nextProtocolStep([], context());
    expect(next.kind).toBe("step");
    if (next.kind === "step") expect(next.stage).toBe("inspect");
  });

  it("answers a failure with the next untried inspection, not a dead end", () => {
    const next = nextProtocolStep(
      [failed("Inspect: Is the copy approved?")],
      context({
        inspectionsAvailable: [
          { id: "insp:1", question: "Is the copy approved?" },
          { id: "insp:2", question: "Is the launch date confirmed?" },
        ],
      }),
    );
    expect(next.kind).toBe("step");
    if (next.kind === "step") {
      expect(next.stage).toBe("test_safely");
      expect(next.action).toContain("Is the launch date confirmed?");
    }
  });

  it("retrieves a named unknown when inspections run out", () => {
    const next = nextProtocolStep(
      [failed("Inspect: the only angle available")],
      context({ unknowns: ["Who owns final copy approval?"] }),
    );
    expect(next.kind).toBe("step");
    if (next.kind === "step") {
      expect(next.stage).toBe("retrieve");
      expect(next.action).toContain("Who owns final copy approval?");
    }
  });

  it("adjusts the reading when diagnostics remain but nothing new to inspect", () => {
    const next = nextProtocolStep([failed("Attempt one")], context());
    expect(next.kind).toBe("step");
    if (next.kind === "step") expect(next.stage).toBe("adjust");
  });

  it(`escalates after ${MAX_DIAGNOSTIC_ATTEMPTS} failed attempts, naming what was tried`, () => {
    const attempts = [failed("one"), failed("two"), failed("three")];
    const next = nextProtocolStep(attempts, context({ unknowns: ["the client contact"] }));
    expect(next.kind).toBe("escalate");
    if (next.kind === "escalate") {
      expect(next.because).toContain("one");
      expect(next.blockedOn).toBe("the client contact");
    }
  });

  it("escalates immediately when the boundary requires a person", () => {
    const next = nextProtocolStep(
      [{ stage: "act_within_boundary", action: "Send the email", outcome: "blocked" }],
      context({ blockedOn: "comms.write approval" }),
    );
    expect(next.kind).toBe("escalate");
    if (next.kind === "escalate") expect(next.blockedOn).toBe("comms.write approval");
  });

  it("moves to verification after a success, never straight to done", () => {
    const next = nextProtocolStep(
      [{ stage: "act_within_boundary", action: "Created the task", outcome: "success" }],
      context(),
    );
    expect(next.kind).toBe("verify");
    if (next.kind === "verify") expect(next.evidenceKind).toBe("changed_state");
  });
});
