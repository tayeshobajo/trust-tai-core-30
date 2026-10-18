import { describe, expect, it } from "vitest";

import { CANONICAL_RUN_BRIDGE, preparationAvailability } from "./steward-preparation-actions";

describe("bounded preparation catalog", () => {
  it("the canonical run bridge is unavailable with a precise reason", () => {
    expect(CANONICAL_RUN_BRIDGE.available).toBe(false);
    expect(CANONICAL_RUN_BRIDGE.because).toContain("must never auto-complete");
  });

  it("offers nothing when the task has no recorded context", () => {
    const actions = preparationAvailability({
      context_links: [],
      notes: null,
      acceptance_criteria: [],
    });
    expect(actions.every((a) => !a.offered)).toBe(true);
    expect(actions[0]!.because).toContain("No recorded context");
  });

  it("offers context-backed actions but keeps them disabled pending the bridge", () => {
    const actions = preparationAvailability({
      context_links: [{ label: "Brief", url: "https://example.com/brief" }],
      notes: null,
      acceptance_criteria: [],
    });
    const brief = actions.find((a) => a.action.id === "prepare_brief")!;
    expect(brief.offered).toBe(true);
    expect(brief.because).toBe(CANONICAL_RUN_BRIDGE.because);
    /* Reviewing an output needs a recorded output link. */
    expect(actions.find((a) => a.action.id === "review_output")!.offered).toBe(false);
  });

  it("offers output review only when an output link is recorded", () => {
    const actions = preparationAvailability({
      context_links: [{ label: "Draft", url: "https://example.com/draft", kind: "output" }],
      notes: null,
      acceptance_criteria: [],
    });
    expect(actions.find((a) => a.action.id === "review_output")!.offered).toBe(true);
  });
});
