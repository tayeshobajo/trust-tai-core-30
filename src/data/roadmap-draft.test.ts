import { describe, expect, it } from "vitest";

import { composeRoadmapDraft, type RoadmapSourceContext } from "./roadmap-draft";
import { UNKNOWN_STATEMENT } from "@/domain/roadmap";

const AT = "2026-01-01T00:00:00.000Z";

function context(overrides: Partial<RoadmapSourceContext> = {}): RoadmapSourceContext {
  return {
    subject: { kind: "prospect", id: "p1", label: "Northbank Dental" },
    objective: "A booking system their front desk can run alone",
    observed: [],
    inferred: [],
    decided: [],
    openQuestions: [],
    generatedAt: AT,
    ...overrides,
  };
}

const observedNote = {
  label: "Website",
  value: "https://northbank.example",
  tier: "observed" as const,
  evidence: [{ label: "Public website", kind: "page" as const, url: "https://northbank.example" }],
  at: AT,
};

describe("composeRoadmapDraft", () => {
  it("keeps Point A to observed facts only", () => {
    const draft = composeRoadmapDraft(
      context({
        observed: [observedNote],
        inferred: [{ ...observedNote, label: "Guess", value: "Probably growing", tier: "inferred" }],
      }),
    );
    expect(draft.pointA).toHaveLength(1);
    expect(draft.pointA.every((note) => note.tier === "observed")).toBe(true);
  });

  it("writes Unknown rather than guessing when nothing is observed", () => {
    const draft = composeRoadmapDraft(context());
    expect(draft.pointA[0]?.value).toBe(UNKNOWN_STATEMENT);
    expect(draft.unknowns.some((entry) => entry.includes("No observed facts"))).toBe(true);
  });

  it("proposes a destination as inferred, never decided", () => {
    const draft = composeRoadmapDraft(context({ observed: [observedNote] }));
    expect(draft.pointB.tier).toBe("inferred");
    expect(draft.pointB.statement).toBe("A booking system their front desk can run alone");
  });

  it("treats a decided destination note as decided", () => {
    const draft = composeRoadmapDraft(
      context({
        decided: [
          {
            label: "Agreed outcome",
            value: "Two clinics live by March",
            tier: "decided",
            evidence: [{ label: "Agreed on a call", kind: "human" }],
            at: AT,
          },
        ],
      }),
    );
    expect(draft.pointB.tier).toBe("decided");
    expect(draft.pointB.statement).toBe("Two clinics live by March");
  });

  it("asks for approval of an inferred destination before anything else", () => {
    const draft = composeRoadmapDraft(context({ observed: [observedNote], ownerLabel: "Tai" }));
    expect(draft.decisions[0]?.question).toContain("the right destination");
    expect(draft.nextMove.action).toBe(draft.decisions[0]?.question);
  });

  it("raises ownership as a decision when no one carries it", () => {
    const draft = composeRoadmapDraft(context({ observed: [observedNote] }));
    expect(draft.decisions.some((entry) => entry.question === "Who carries this roadmap?")).toBe(true);
  });

  it("does not raise ownership when an owner is known", () => {
    const draft = composeRoadmapDraft(context({ observed: [observedNote], ownerLabel: "Tai" }));
    expect(draft.decisions.some((entry) => entry.question === "Who carries this roadmap?")).toBe(false);
  });

  it("only recommends approval when observed evidence supports it", () => {
    const bare = composeRoadmapDraft(context({ ownerLabel: "Tai" }));
    expect(bare.decisions[0]?.recommendation).toBeUndefined();
    const evidenced = composeRoadmapDraft(context({ observed: [observedNote], ownerLabel: "Tai" }));
    expect(evidenced.decisions[0]?.recommendation).toBe("Approve as written");
  });

  it("opens the walk with confirming current truth while gaps remain", () => {
    const draft = composeRoadmapDraft(context());
    expect(draft.stages[0]?.title).toBe("Confirm current truth");
    expect(draft.stages[0]?.state).toBe("in_build");
  });

  it("skips the confirmation stage once nothing is unknown", () => {
    const draft = composeRoadmapDraft(context({ observed: [observedNote], ownerLabel: "Tai" }));
    expect(draft.stages[0]?.title).toBe("Agree the destination");
  });

  it("marks every method stage as inferred, never observed", () => {
    const draft = composeRoadmapDraft(context({ observed: [observedNote], ownerLabel: "Tai" }));
    expect(draft.stages.every((stage) => stage.tier === "inferred")).toBe(true);
    expect(draft.stages.every((stage) => stage.evidence.length > 0)).toBe(true);
  });

  it("is deterministic for the same context", () => {
    const input = context({ observed: [observedNote], ownerLabel: "Tai" });
    expect(composeRoadmapDraft(input)).toEqual(composeRoadmapDraft(input));
  });

  it("carries explicit open questions through to decisions", () => {
    const draft = composeRoadmapDraft(
      context({
        observed: [observedNote],
        ownerLabel: "Tai",
        openQuestions: [{ question: "Do they own their domain?", whyItMatters: "Migration depends on it." }],
      }),
    );
    expect(draft.decisions.at(-1)?.question).toBe("Do they own their domain?");
  });

  it("never invents a timeline or budget in any stage", () => {
    const draft = composeRoadmapDraft(context({ observed: [observedNote], ownerLabel: "Tai" }));
    const text = JSON.stringify(draft.stages).toLowerCase();
    expect(text).not.toMatch(/week|month|£|\$|budget|deadline/);
  });

  it("falls back to Unknown when no objective is given", () => {
    const draft = composeRoadmapDraft(context({ objective: "" }));
    expect(draft.pointB.statement).toBe(UNKNOWN_STATEMENT);
    expect(draft.unknowns.some((entry) => entry.includes("destination"))).toBe(true);
  });
});
