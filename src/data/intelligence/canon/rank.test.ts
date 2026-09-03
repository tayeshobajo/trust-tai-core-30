/**
 * Ranking must be decidable by reading the numbers it publishes, and history
 * must never be able to overturn what is visible today.
 */
import { describe, expect, it } from "vitest";

import type { PatternMatch } from "@/domain/intelligence-canon";
import { HISTORY_BAND, narrateRanking, rankHypotheses } from "./rank";
import { classifyPriorCase } from "./experience";
import type { PriorExperience } from "./experience";
import type { IntelligenceCase } from "@/domain/intelligence-canon";

const NOW = "2026-03-01T00:00:00.000Z";

function match(overrides: Partial<PatternMatch> & { patternId: string }): PatternMatch {
  return {
    patternName: overrides.patternId,
    domain: "delivery",
    score: 0.6,
    because: "because",
    matched: [
      {
        observationId: "obs:project_delayed:p1",
        observationKind: "project_delayed",
        statement: "one project is past its date",
        tier: "observed",
        sourceApps: ["projects"],
      },
      {
        observationId: "obs:reply_debt:r1",
        observationKind: "reply_debt",
        statement: "two replies are owed",
        tier: "observed",
        sourceApps: ["comms"],
      },
    ],
    missingEvidence: [],
    unmetConditions: [],
    contradicting: [],
    competingExplanations: [],
...overrides,
  } as PatternMatch;
}

function experience(overrides: Partial<PriorExperience>): PriorExperience {
  return {
    patternId: "x",
    cases: [],
    priorCases: [],
    corrections: [],
    standing: {
      patternId: "x",
      outcomes: 0,
      successes: 0,
      failures: 0,
      unknown: 0,
      hasLesson: false,
      corrections: [],
      guidance: "",
    },
    note: null,
...overrides,
  } as PriorExperience;
}

describe("ranking competing readings", () => {
  it("orders by current evidence and publishes the features behind the order", () => {
    const ranked = rankHypotheses({
      matches: [
        match({ patternId: "weak", score: 0.4, missingEvidence: [
          { appId: "projects", inspect: "the project owner field", wouldConfirm: "an owner", wouldRefute: "no owner" },
        ] }),
        match({ patternId: "strong", score: 0.95 }),
      ],
      now: NOW,
    });
    expect(ranked[0]!.patternId).toBe("strong");
    expect(ranked[0]!.features.currentEvidence).toBeGreaterThan(
      ranked[1]!.features.currentEvidence,
    );
  });

  it("never lets prior experience overturn a clear evidence difference", () => {
    const ranked = rankHypotheses({
      matches: [match({ patternId: "strong", score: 0.95 }), match({ patternId: "weak", score: 0.3 })],
      experience: {
        weak: experience({
          standing: {
            patternId: "weak",
            outcomes: 4,
            successes: 4,
            failures: 0,
            unknown: 0,
            hasLesson: true,
            corrections: [],
            guidance: "",
          },
        }),
      },
      now: NOW,
    });
    expect(ranked[0]!.patternId).toBe("strong");
    expect(Math.abs(ranked[1]!.features.historyAdjustment)).toBeLessThanOrEqual(HISTORY_BAND);
  });

  it("treats a human correction as caution, not as outcome support", () => {
    const corrected = experience({
      corrections: ["That was a scheduling issue, not capacity."],
      standing: {
        patternId: "a",
        outcomes: 3,
        successes: 3,
        failures: 0,
        unknown: 0,
        hasLesson: true,
        corrections: [],
        guidance: "",
      },
    });
    const ranked = rankHypotheses({
      matches: [match({ patternId: "a" })],
      experience: { a: corrected },
      now: NOW,
    });
    expect(ranked[0]!.features.humanCorrected).toBe(true);
    expect(ranked[0]!.features.historyAdjustment).toBeLessThan(0);
  });

  it("says the leading reading, the runner up and what to check", () => {
    const text = narrateRanking(
      rankHypotheses({
        matches: [
          match({
            patternId: "a",
            patternName: "Delivery is slipping while replies pile up",
            score: 0.9,
            missingEvidence: [{ appId: "projects", inspect: "who is on this project", wouldConfirm: "two people", wouldRefute: "one person" }],
          }),
          match({ patternId: "b", patternName: "Pipeline is unrouted", score: 0.5 }),
        ],
        now: NOW,
      }),
    );
    expect(text).toContain("Likely:");
    expect(text).toContain("Also plausible:");
    expect(text).toContain("before acting");
    expect(text).not.toContain(", ");
  });
});

describe("prior case resemblance", () => {
  function priorCase(refs: string[], correction?: string): IntelligenceCase {
    return {
      id: "c1",
      organizationId: "org",
      patternId: "a",
      patternVersion: 1,
      entities: [],
      evidenceRefs: refs.map((id) => ({ kind: "observation", id })),
      hypothesis: "h",
      humanDecision: "accepted",
      decidedBy: "u",
      decidedAt: NOW,
      diagnosisVerdict: "unknown",
...(correction ? { correction }: {}),
      createdAt: NOW,
    } as IntelligenceCase;
  }

  it("calls a case on the same facts a close resemblance", () => {
    const row = classifyPriorCase(priorCase(["obs:project_delayed:p1", "obs:reply_debt:r1"]), [
      "project_delayed",
      "reply_debt",
    ]);
    expect(row.analogy).toBe("same_shape");
    expect(row.strongPrecedent).toBe(true);
  });

  it("refuses to call a case on different facts strong precedent", () => {
    const row = classifyPriorCase(priorCase(["obs:pipeline_unrouted:x"]), [
      "project_delayed",
      "reply_debt",
    ]);
    expect(row.analogy).toBe("different_shape");
    expect(row.strongPrecedent).toBe(false);
  });

  it("puts a corrected case above both", () => {
    const row = classifyPriorCase(priorCase(["obs:pipeline_unrouted:x"], "Not capacity."), []);
    expect(row.analogy).toBe("human_corrected");
    expect(row.strongPrecedent).toBe(true);
  });
});
