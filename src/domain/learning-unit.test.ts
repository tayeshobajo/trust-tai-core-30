import { describe, expect, it } from "vitest";

import {
  assembleLearningUnit,
  attachReflection,
  markReflectionPending,
  unitHasNewInformation,
  type Reflection,
} from "@/domain/learning-unit";
import { buildDimensionalRecord } from "@/domain/dimensional-record";
import { appendOutcomeEvent } from "@/domain/outcome-fill";

const NOW = "2026-09-24T12:00:00.000Z";

function rationaleFixture() {
  const dimensional = buildDimensionalRecord({
    register: "warm_intro",
    decideAction: "congratulate",
    relationshipStage: "aware",
    archetype: "agency",
    confidence: 0.8,
    voice: "pass",
    truth: "pass",
    now: NOW,
  });
  const withEvent = appendOutcomeEvent(dimensional, {
    kind: "reply_observed",
    observed_at: NOW,
    channel: "email_gmail",
    message_ref: "msg-1",
    attribution: "direct_reply",
    evidence: "thread_metadata",
  })!;
  return {
    drafted_body: "Congrats! By the way, your website could use...",
    decide: { action: "congratulate", confidence: 0.8, rationale: ["Milestone observed."] },
    world_card: { summary: "Agency announcing a second office." },
    dimensional: { ...withEvent, tai_intervention: "edited" },
    correction: {
      decision: "approved_with_edits",
      situation: {
        register: "warm_intro",
        intent: "congratulate",
        decideAction: "congratulate",
        worldCardSummary: "Agency announcing a second office.",
      },
      draft_excerpt: "Congrats! By the way, your website could use...",
      approved_excerpt: "Congrats on the second office. That is a real milestone.",
      diff_summary: "1 sentence(s) removed or rewritten",
      learned_principle: null,
      captured_at: NOW,
    },
  };
}

function reflectionFixture(): Reflection {
  return {
    believed: "Congratulate with a pitch attached, confidence 0.8.",
    interventionTaught: "Tai removed the pitch; stay with the moment.",
    responseEvidenced: "The person replied warmly.",
    candidatePrinciple: {
      principle:
        "Tai tends toward staying with the person's moment, except when help was explicitly requested, where evidence suggests offering it directly.",
      scope: { domain: "relationship_nurture", contextTags: ["milestone_event"] },
      confidenceBoundary: "Milestone touches only; not cold first contact.",
      confidence: 0.3,
      contradictsExisting: null,
    },
    trainingDebt: null,
    producedAt: NOW,
    provider: "test",
    model: "test",
  };
}

describe("assembleLearningUnit", () => {
  it("assembles the full chain from stored rows", () => {
    const unit = assembleLearningUnit({
      organizationId: "org-1",
      relationshipId: "rel-1",
      draftId: "draft-1",
      rationale: rationaleFixture(),
      contextTags: ["milestone_event"],
      domain: "relationship_nurture",
      now: NOW,
    });
    expect(unit.decide?.action).toBe("congratulate");
    expect(unit.worldCardSummary).toContain("second office");
    expect(unit.dimensional?.tai_intervention).toBe("edited");
    expect(unit.editCorrection?.decision).toBe("approved_with_edits");
    expect(unit.outcomeEvents).toHaveLength(1);
    expect(unit.context.contextTags).toEqual(["milestone_event"]);
    expect(unitHasNewInformation(unit)).toBe(true);
  });

  it("leaves missing legs null and honest", () => {
    const unit = assembleLearningUnit({ organizationId: "org-1", rationale: {}, now: NOW });
    expect(unit.decide).toBeNull();
    expect(unit.dimensional).toBeNull();
    expect(unit.editCorrection).toBeNull();
    expect(unit.outcomeEvents).toEqual([]);
    expect(unitHasNewInformation(unit)).toBe(false);
  });
});

describe("markReflectionPending", () => {
  it("adds the queued flag additively and idempotently", () => {
    const rationale = rationaleFixture();
    const marked = markReflectionPending(rationale, "outcome_event", NOW);
    expect(marked).not.toBeNull();
    expect((marked!["learning"] as Record<string, unknown>)["reflection_pending"]).toBe(true);
    expect(marked!["correction"]).toEqual(rationale.correction);
    expect(markReflectionPending(marked, "outcome_event", NOW)).toBeNull();
  });
});

describe("attachReflection: reflection cannot mutate evidence", () => {
  it("attaches under learning and leaves every evidence leg untouched", () => {
    const rationale = rationaleFixture();
    const frozenEvents = JSON.stringify(
      (rationale.dimensional as Record<string, unknown>)["outcome_events"],
    );
    const next = attachReflection(rationale, reflectionFixture());
    expect(
      JSON.stringify((next["dimensional"] as Record<string, unknown>)["outcome_events"]),
    ).toBe(frozenEvents);
    expect(next["correction"]).toEqual(rationale.correction);
    const learning = next["learning"] as Record<string, unknown>;
    expect((learning["reflection"] as Reflection).candidatePrinciple?.principle).toContain(
      "staying with the person's moment",
    );
  });

  it("throws when a write would drift the outcome events, and writes nothing", () => {
    const rationale = rationaleFixture();
    const poisoned = Object.create(rationale) as Record<string, unknown>;
    /* A tampering caller that swaps the dimensional record mid-flight. */
    let reads = 0;
    Object.defineProperty(poisoned, "dimensional", {
      enumerable: true,
      get() {
        reads += 1;
        return reads <= 1
          ? rationale.dimensional
          : { ...rationale.dimensional, outcome_events: [] };
      },
    });
    expect(() => attachReflection(poisoned, reflectionFixture())).toThrow(
      /never mutate outcome events/,
    );
  });

  it("refuses to invent a record to attach to", () => {
    expect(() => attachReflection(null, reflectionFixture())).toThrow(/nothing was invented/);
  });
});
