import { describe, expect, it } from "vitest";

import {
  applyContradictingEvidence,
  applySupportingEvidence,
  canTransition,
  promotionReading,
  resolveChallenge,
  type EvidenceRef,
  type Principle,
} from "@/domain/principle-lifecycle";

const NOW = "2026-09-24T12:00:00.000Z";

function evidence(unitId: string, relationshipId: string, tags: string[]): EvidenceRef {
  return { unitId, relationshipId, contextTags: tags, capturedAt: NOW };
}

function principle(overrides: Partial<Principle> = {}): Principle {
  return {
    id: "p-1",
    organizationId: "org-1",
    principle: "A relationship touch does not need to advance the sale to advance the relationship.",
    scope: { domain: "relationship_nurture", contextTags: ["milestone_event"] },
    status: "provisional",
    source: "inferred",
    confidence: 0.3,
    supportingEvidence: [evidence("u1", "rel-1", ["milestone_event"])],
    contradictingEvidence: [],
    contextsObserved: ["milestone_event"],
    relationshipsObserved: ["rel-1"],
    lastValidatedAt: NOW,
    supersededBy: null,
    transitionReason: null,
    ...overrides,
  };
}

describe("canTransition", () => {
  it("allows exactly the lawful lifecycle moves", () => {
    expect(canTransition("provisional", "active")).toBe(true);
    expect(canTransition("active", "strengthened")).toBe(true);
    expect(canTransition("active", "challenged")).toBe(true);
    expect(canTransition("strengthened", "challenged")).toBe(true);
    expect(canTransition("challenged", "strengthened")).toBe(true);
    expect(canTransition("challenged", "superseded")).toBe(true);
    expect(canTransition("challenged", "retired")).toBe(true);
    expect(canTransition("provisional", "strengthened")).toBe(false);
    expect(canTransition("active", "retired")).toBe(false);
    expect(canTransition("superseded", "active")).toBe(false);
    expect(canTransition("retired", "provisional")).toBe(false);
  });
});

describe("promotionReading", () => {
  it("blocks promotion under 3 units or 2 relationships", () => {
    const reading = promotionReading(
      principle({
        supportingEvidence: [
          evidence("u1", "rel-1", ["milestone_event"]),
          evidence("u2", "rel-1", ["milestone_event"]),
          evidence("u3", "rel-1", ["milestone_event"]),
        ],
      }),
    );
    expect(reading.eligible).toBe(false);
    expect(reading.because).toContain("1 relationship");
  });

  it("promotes with 3 units across 2 relationships, scoped to the one shared context", () => {
    const reading = promotionReading(
      principle({
        supportingEvidence: [
          evidence("u1", "rel-1", ["milestone_event"]),
          evidence("u2", "rel-2", ["milestone_event"]),
          evidence("u3", "rel-3", ["milestone_event"]),
        ],
      }),
    );
    expect(reading.eligible).toBe(true);
    expect(reading.universalWithinDomain).toBe(false);
    expect(reading.earnedScope?.contextTags).toEqual(["milestone_event"]);
    expect(reading.because).toContain("stays scoped");
  });

  it("earns universality only with >= 2 distinct context tags", () => {
    const reading = promotionReading(
      principle({
        supportingEvidence: [
          evidence("u1", "rel-1", ["milestone_event"]),
          evidence("u2", "rel-2", ["award_announcement"]),
          evidence("u3", "rel-3", ["milestone_event"]),
        ],
      }),
    );
    expect(reading.eligible).toBe(true);
    expect(reading.universalWithinDomain).toBe(true);
  });

  it("tai_confirmed promotes immediately with evidence and scope preserved", () => {
    const reading = promotionReading(
      principle({
        source: "tai_confirmed",
        supportingEvidence: [evidence("u1", "rel-1", ["milestone_event"])],
      }),
    );
    expect(reading.eligible).toBe(true);
    expect(reading.earnedScope?.contextTags).toEqual(["milestone_event"]);
    expect(reading.because).toContain("Tai confirmed");
  });
});

describe("supporting evidence", () => {
  it("promotes a provisional principle when the reading carries it", () => {
    const base = principle({
      supportingEvidence: [
        evidence("u1", "rel-1", ["milestone_event"]),
        evidence("u2", "rel-2", ["milestone_event"]),
      ],
      relationshipsObserved: ["rel-1", "rel-2"],
    });
    const applied = applySupportingEvidence(base, evidence("u3", "rel-3", ["milestone_event"]), NOW);
    expect(applied.principle.status).toBe("active");
    expect(applied.transition).toEqual(
      expect.objectContaining({ from: "provisional", to: "active" }),
    );
    expect(applied.principle.confidence).toBeGreaterThan(base.confidence);
  });

  it("strengthens an active principle that keeps validating across contexts", () => {
    const base = principle({
      status: "active",
      supportingEvidence: [
        evidence("u1", "rel-1", ["milestone_event"]),
        evidence("u2", "rel-2", ["milestone_event"]),
        evidence("u3", "rel-3", ["award_announcement"]),
        evidence("u4", "rel-4", ["milestone_event"]),
      ],
      contextsObserved: ["milestone_event", "award_announcement"],
    });
    const applied = applySupportingEvidence(base, evidence("u5", "rel-5", ["award_announcement"]), NOW);
    expect(applied.principle.status).toBe("strengthened");
  });
});

describe("contradicting evidence", () => {
  it("moves an active principle to challenged, reduces confidence, flags Tai", () => {
    const base = principle({ status: "active", confidence: 0.7 });
    const applied = applyContradictingEvidence(base, evidence("u9", "rel-9", ["milestone_event"]), NOW);
    expect(applied.principle.status).toBe("challenged");
    expect(applied.principle.confidence).toBeLessThan(0.7);
    expect(applied.flagForTai).toContain("never auto-resolve");
    expect(applied.principle.contradictingEvidence).toHaveLength(1);
  });

  it("never touches a terminal principle", () => {
    const base = principle({ status: "retired" });
    const applied = applyContradictingEvidence(base, evidence("u9", "rel-9", []), NOW);
    expect(applied.principle).toBe(base);
  });
});

describe("resolveChallenge", () => {
  it("supersession preserves history and links the replacement", () => {
    const challenged = principle({ status: "challenged", confidence: 0.4 });
    const resolved = resolveChallenge(challenged, {
      kind: "supersede",
      replacementId: "p-2",
      reason: "The world changed: milestone touches now land better with a soft offer.",
    });
    expect(resolved.status).toBe("superseded");
    expect(resolved.supersededBy).toBe("p-2");
    expect(resolved.transitionReason).toContain("world changed");
    expect(resolved.supportingEvidence).toEqual(challenged.supportingEvidence);
  });

  it("retirement records why; strengthening restores confidence", () => {
    const challenged = principle({ status: "challenged", confidence: 0.4 });
    expect(resolveChallenge(challenged, { kind: "retire", reason: "No longer true." }).status).toBe(
      "retired",
    );
    const strengthened = resolveChallenge(challenged, {
      kind: "strengthen",
      reason: "The contradiction was a one-off.",
    });
    expect(strengthened.status).toBe("strengthened");
    expect(strengthened.confidence).toBeGreaterThan(0.4);
  });

  it("only a challenged principle can be resolved", () => {
    expect(() => resolveChallenge(principle({ status: "active" }), { kind: "retire", reason: "x" })).toThrow(
      /challenged/,
    );
  });
});
