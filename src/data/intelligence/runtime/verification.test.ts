import { describe, expect, it } from "vitest";

import type { CompletionClaim } from "@/domain/intelligence-runtime";

import { describeGap, expectedEvidenceFor, verifyCompletion } from "./verification";

const NOW = "2026-08-22T10:00:00.000Z";

function claim(overrides: Partial<CompletionClaim> = {}): CompletionClaim {
  return {
    room: "projects",
    workRef: "milestone:launch",
    claimedBy: "adapter",
    actionRan: true,
    evidence: [],
    ...overrides,
  };
}

describe("verifyCompletion", () => {
  it("rejects a claim where nothing ran and nothing is proven", () => {
    const verdict = verifyCompletion(claim({ actionRan: false }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.because).toContain("Nothing ran");
  });

  it("rejects 'the action ran' as proof of completion", () => {
    const verdict = verifyCompletion(claim());
    expect(verdict.accepted).toBe(false);
    expect(verdict.because).toContain("not evidence");
  });

  it("accepts a claim backed by the expected kind of evidence", () => {
    const verdict = verifyCompletion(
      claim({
        evidence: [{ kind: "api_response", reference: "paperclip:task:123", observedAt: NOW }],
      }),
      { kind: "api_response", description: "The external system answered." },
    );
    expect(verdict.accepted).toBe(true);
  });

  it("names the missing evidence kind when the claim carries the wrong kind", () => {
    const verdict = verifyCompletion(
      claim({
        evidence: [{ kind: "artifact", reference: "file:brief.pdf", observedAt: NOW }],
      }),
      { kind: "test_result", description: "The regression suite passes." },
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.missing.join(" ")).toContain("test_result");
  });

  it("refuses to let a runtime, adapter or agent grade its own homework", () => {
    const verdict = verifyCompletion(
      claim({
        claimedBy: "agent",
        evidence: [{ kind: "artifact", reference: "note:looks-done", observedAt: NOW }],
      }),
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.missing.join(" ")).toContain("objective proof");
  });

  it("accepts human acceptance in place of any expected kind", () => {
    const verdict = verifyCompletion(
      claim({
        claimedBy: "person",
        evidence: [{ kind: "human_acceptance", reference: "tai:approved", observedAt: NOW }],
      }),
      { kind: "test_result", description: "The regression suite passes." },
    );
    expect(verdict.accepted).toBe(true);
  });

  it("requires acceptance evidence when an acceptance criterion was named", () => {
    const verdict = verifyCompletion(
      claim({
        claimedBy: "person",
        acceptanceCriterion: "The about page loads in under two seconds.",
        evidence: [{ kind: "artifact", reference: "deploy:456", observedAt: NOW }],
      }),
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.missing.join(" ")).toContain("acceptance_criterion");
  });

  it("describes the gap in one honest line", () => {
    const verdict = verifyCompletion(claim());
    expect(describeGap(verdict)).toContain("Missing:");
    expect(describeGap({ accepted: true, because: "proven", missing: [] })).toBeNull();
  });
});

describe("expectedEvidenceFor", () => {
  it("composes expectations from the shape of the work", () => {
    const expectations = expectedEvidenceFor({
      changesSuiteState: true,
      touchesExternalSystem: true,
      handsOffToAnotherRoom: true,
    });
    expect(expectations.map((row) => row.kind)).toEqual([
      "changed_state",
      "api_response",
      "downstream_receipt",
    ]);
  });
});
