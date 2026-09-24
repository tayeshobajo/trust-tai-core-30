import { describe, expect, it } from "vitest";

import {
  buildDimensionalRecord,
  interventionForReview,
  withIntervention,
} from "./dimensional-record";

const NOW = "2026-09-24T00:00:00.000Z";

describe("buildDimensionalRecord", () => {
  it("captures the write path: voice and truth pass, outcome and judgment stay null", () => {
    const record = buildDimensionalRecord({
      register: "scout_intro",
      decideAction: "begin_conversation",
      relationshipStage: "ready_to_reach",
      confidence: 0.8,
      voice: "pass",
      truth: "pass",
      now: NOW,
    });
    expect(record.voice).toBe("pass");
    expect(record.truth).toBe("pass");
    expect(record.judgment).toBeNull();
    expect(record.outcome).toBeNull();
    expect(record.context).toEqual({
      register: "scout_intro",
      decide_action: "begin_conversation",
      relationship_stage: "ready_to_reach",
      archetype: null,
    });
    expect(record.confidence).toBe(0.8);
    expect(record.tai_intervention).toBe("none");
    expect(record.captured_at).toBe(NOW);
  });

  it("captures the no-action path: no words exist, so voice and truth are null", () => {
    const record = buildDimensionalRecord({
      register: "scout_intro",
      decideAction: "do_nothing",
      relationshipStage: null,
      confidence: 0.8,
      now: NOW,
    });
    expect(record.voice).toBeNull();
    expect(record.truth).toBeNull();
    expect(record.outcome).toBeNull();
    expect(record.context.decide_action).toBe("do_nothing");
    expect(record.tai_intervention).toBe("none");
  });

  it("marks an escalated verdict as a Tai intervention from the start", () => {
    const record = buildDimensionalRecord({
      register: "scout_intro",
      decideAction: "escalate_to_tai",
      relationshipStage: "in_conversation",
      confidence: 0.9,
      escalated: true,
      now: NOW,
    });
    expect(record.tai_intervention).toBe("escalated");
  });

  it("clamps confidence into 0..1", () => {
    expect(
      buildDimensionalRecord({
        register: "scout_intro",
        decideAction: "wait",
        relationshipStage: null,
        confidence: 1.7,
      }).confidence,
    ).toBe(1);
  });
});

describe("tai_intervention transitions on review", () => {
  it("approval of unchanged words is approved_unedited", () => {
    expect(interventionForReview("approved", false)).toBe("approved_unedited");
  });

  it("approval of changed words is edited", () => {
    expect(interventionForReview("approved", true)).toBe("edited");
  });

  it("a discard is rejected", () => {
    expect(interventionForReview("discarded", false)).toBe("rejected");
    expect(interventionForReview("discarded", true)).toBe("rejected");
  });

  it("other transitions leave the record alone", () => {
    expect(interventionForReview("needs_redraft", true)).toBeNull();
  });

  it("withIntervention stamps a stored jsonb record and refuses to invent one", () => {
    const stored = buildDimensionalRecord({
      register: "scout_intro",
      decideAction: "begin_conversation",
      relationshipStage: "ready_to_reach",
      confidence: 0.8,
      voice: "pass",
      truth: "pass",
      now: NOW,
    });
    const roundTripped = JSON.parse(JSON.stringify(stored)) as unknown;

    const edited = withIntervention(roundTripped, "approved", true);
    expect(edited?.["tai_intervention"]).toBe("edited");
    const agreed = withIntervention(roundTripped, "approved", false);
    expect(agreed?.["tai_intervention"]).toBe("approved_unedited");
    const rejected = withIntervention(roundTripped, "discarded", false);
    expect(rejected?.["tai_intervention"]).toBe("rejected");

    expect(withIntervention(null, "approved", true)).toBeNull();
    expect(withIntervention(roundTripped, "needs_redraft", true)).toBeNull();
  });
});
