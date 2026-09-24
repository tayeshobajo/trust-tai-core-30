import { describe, expect, it } from "vitest";

import { deriveOpportunityGap, gapIntelFromMetadata, signalStatements } from "./scout-opportunity-gap";

describe("opportunity gap read", () => {
  it("is unknown when evidence is insufficient", () => {
    expect(
      deriveOpportunityGap({ momentumEvidence: [], weaknessEvidence: [], healthEvidence: [] }).gap,
    ).toBe("unknown");
    expect(
      deriveOpportunityGap({
        momentumEvidence: ["Hiring"],
        weaknessEvidence: [],
        healthEvidence: [],
      }).gap,
    ).toBe("unknown");
  });

  it("is high only when both momentum and weakness are strong", () => {
    const read = deriveOpportunityGap({
      momentumEvidence: ["Hiring", "New cohort announced"],
      weaknessEvidence: ["No lead capture", "Stale footer year"],
      healthEvidence: [],
    });
    expect(read.gap).toBe("high");
    expect(read.momentumEvidence).toHaveLength(2);
    expect(read.maturityEvidence).toHaveLength(2);
  });

  it("is medium with one read on each side", () => {
    expect(
      deriveOpportunityGap({
        momentumEvidence: ["Hiring"],
        weaknessEvidence: ["No lead capture"],
        healthEvidence: [],
      }).gap,
    ).toBe("medium");
  });

  it("is low when digital strength is positively observed and nothing weak was seen", () => {
    const read = deriveOpportunityGap({
      momentumEvidence: ["Raised Series B"],
      weaknessEvidence: [],
      healthEvidence: ["In-house engineering team"],
    });
    expect(read.gap).toBe("low");
    expect(read.maturityEvidence).toEqual(["In-house engineering team"]);
  });

  it("holds contradictory strong-and-weak reads at medium", () => {
    expect(
      deriveOpportunityGap({
        momentumEvidence: [],
        weaknessEvidence: ["Broken checkout"],
        healthEvidence: ["Modern site"],
      }).gap,
    ).toBe("medium");
  });

  it("reads statements tolerantly and metadata safely", () => {
    expect(
      signalStatements([{ statement: "A" }, { signal: "B" }, "C", null, { other: 1 }]),
    ).toEqual(["A", "B", "C"]);
    expect(gapIntelFromMetadata(null)).toBeNull();
    expect(gapIntelFromMetadata({ scout_intel: { buying_signals: [1] } })).toEqual({
      buying_signals: [1],
      opportunities: undefined,
    });
  });
});
