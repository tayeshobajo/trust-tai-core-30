/**
 * The Shared Intelligence Read laws, pinned.
 *
 * decided > observed > inferred > recommended > unknown, newer first inside a
 * tier; a losing claim stays visible; a human correction outranks inference
 * permanently; an unread source stays unknown; a recommendation never becomes
 * truth; and the read never claims model reasoning it did not do.
 */

import { describe, expect, it } from "vitest";

import {
  composeIntelligenceRead,
  resolveClaims,
  tierRank,
  type ReadCapabilities,
  type ReadClaim,
  type ReadTier,
} from "./intelligence-read";

const CAPABILITIES: ReadCapabilities = {
  executable: [],
  unavailable: [],
  externalSurfaces: [],
  readOnly: true,
};

function claim(over: Partial<ReadClaim> & { id: string; tier: ReadTier }): ReadClaim {
  return {
    aspect: "domain",
    statement: `statement ${over.id}`,
    origin: "observed",
    at: "2026-09-01T00:00:00.000Z",
    evidenceRefs: [over.id],
    sources: [{ label: "source" }],
    ...over,
  } as ReadClaim;
}

describe("truth precedence", () => {
  it("orders the tiers decided, observed, inferred, recommended, unknown", () => {
    const tiers: ReadTier[] = ["decided", "observed", "inferred", "recommended", "unknown"];
    const ranks = tiers.map(tierRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("lets the strongest tier lead for an aspect", () => {
    const { leading } = resolveClaims([
      claim({ id: "inferred", tier: "inferred", statement: "northfield.com" }),
      claim({ id: "decided", tier: "decided", statement: "northfielddental.com" }),
    ]);
    expect(leading).toHaveLength(1);
    expect(leading[0]?.statement).toBe("northfielddental.com");
  });

  it("prefers the newer claim inside the same tier", () => {
    const { leading } = resolveClaims([
      claim({ id: "old", tier: "observed", at: "2026-01-01T00:00:00.000Z", statement: "old" }),
      claim({ id: "new", tier: "observed", at: "2026-09-01T00:00:00.000Z", statement: "new" }),
    ]);
    expect(leading[0]?.statement).toBe("new");
  });

  it("never conflates claims about different aspects", () => {
    const { leading, conflicts } = resolveClaims([
      claim({ id: "a", tier: "observed", aspect: "domain" }),
      claim({ id: "b", tier: "observed", aspect: "founder" }),
    ]);
    expect(leading).toHaveLength(2);
    expect(conflicts).toEqual([]);
  });
});

describe("conflicts stay visible", () => {
  it("keeps the losing claim with its own tier, source and timestamp", () => {
    const { conflicts } = resolveClaims([
      claim({
        id: "web",
        tier: "observed",
        statement: "northfield.com",
        at: "2026-02-02T00:00:00.000Z",
        sources: [{ label: "Website" }],
      }),
      claim({ id: "human", tier: "decided", statement: "northfielddental.com", origin: "human" }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.leading.statement).toBe("northfielddental.com");
    const losing = conflicts[0]?.losing[0];
    expect(losing?.statement).toBe("northfield.com");
    expect(losing?.tier).toBe("observed");
    expect(losing?.at).toBe("2026-02-02T00:00:00.000Z");
    expect(losing?.sources[0]?.label).toBe("Website");
  });

  it("treats the same statement twice as agreement, not disagreement", () => {
    const { conflicts } = resolveClaims([
      claim({ id: "a", tier: "observed", statement: "Nashville, TN" }),
      claim({ id: "b", tier: "inferred", statement: "nashville, tn " }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it("keeps a human correction ahead of inference permanently", () => {
    const { leading, conflicts } = resolveClaims([
      claim({
        id: "model",
        tier: "inferred",
        origin: "model",
        statement: "They are enterprise",
        at: "2026-12-01T00:00:00.000Z",
      }),
      claim({
        id: "person",
        tier: "decided",
        origin: "human",
        statement: "They are a small practice",
        at: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    expect(leading[0]?.origin).toBe("human");
    expect(conflicts[0]?.losing[0]?.id).toBe("model");
  });
});

describe("composeIntelligenceRead", () => {
  const base = {
    organizationId: "org-1",
    room: "scout",
    subject: { type: "prospect", label: "Northfield Dental" },
    asOf: "2026-09-09T10:00:00.000Z",
    capabilities: CAPABILITIES,
  };

  it("keeps unknown and withheld honest rather than zero", () => {
    const read = composeIntelligenceRead({
      ...base,
      claims: [],
      unknowns: ["No email route is known."],
      withheld: [{ appId: "icp_profiles", reason: "no_data" }],
    });
    expect(read.claims).toEqual([]);
    expect(read.confidence).toBe("unknown");
    expect(read.unknowns).toEqual(["No email route is known."]);
    expect(read.withheld).toEqual([{ appId: "icp_profiles", reason: "no_data" }]);
  });

  it("never lets inference raise confidence", () => {
    const read = composeIntelligenceRead({
      ...base,
      claims: [
        claim({ id: "i1", tier: "inferred", aspect: "a" }),
        claim({ id: "i2", tier: "inferred", aspect: "b" }),
        claim({ id: "i3", tier: "inferred", aspect: "c" }),
      ],
    });
    expect(read.confidence).toBe("unknown");
  });

  it("derives confidence from grounded claims only", () => {
    const read = composeIntelligenceRead({
      ...base,
      claims: [
        claim({ id: "o1", tier: "observed", aspect: "a" }),
        claim({ id: "d1", tier: "decided", aspect: "b", origin: "human" }),
        claim({ id: "i1", tier: "inferred", aspect: "c" }),
      ],
    });
    expect(read.confidence).toBe("moderate");
  });

  it("keeps recommendations non-authoritative", () => {
    const read = composeIntelligenceRead({
      ...base,
      claims: [],
      recommendations: [
        {
          id: "r1",
          title: "Find a contact route",
          because: "No email route is known.",
          owningRoom: "scout",
          requiresApproval: true,
          origin: "deterministic",
          authoritative: false,
        },
      ],
    });
    expect(read.recommendations[0]?.authoritative).toBe(false);
    /* A recommendation is not a claim about the world. */
    expect(read.claims).toEqual([]);
    expect(read.confidence).toBe("unknown");
  });

  it("does not claim model reasoning that did not happen", () => {
    const deterministic = composeIntelligenceRead({
      ...base,
      claims: [claim({ id: "o1", tier: "observed" })],
    });
    expect(deterministic.producedBy).toBe("deterministic");

    const mixed = composeIntelligenceRead({
      ...base,
      claims: [
        claim({ id: "o1", tier: "observed", aspect: "a" }),
        claim({ id: "m1", tier: "inferred", aspect: "b", origin: "model" }),
      ],
    });
    expect(mixed.producedBy).toBe("mixed");

    const modelOnly = composeIntelligenceRead({
      ...base,
      claims: [claim({ id: "m1", tier: "inferred", origin: "model" })],
    });
    expect(modelOnly.producedBy).toBe("model");
  });

  it("collects provenance from leading and losing claims alike", () => {
    const read = composeIntelligenceRead({
      ...base,
      claims: [
        claim({ id: "web", tier: "observed", statement: "a", sources: [{ label: "Website" }] }),
        claim({
          id: "person",
          tier: "decided",
          origin: "human",
          statement: "b",
          sources: [{ label: "Corrected by a person" }],
        }),
      ],
      knowledgeRefs: ["pattern-1"],
    });
    expect(read.provenance.sources.map((s) => s.label)).toEqual([
      "Corrected by a person",
      "Website",
    ]);
    expect(read.provenance.knowledgeRefs).toEqual(["pattern-1"]);
  });
});
