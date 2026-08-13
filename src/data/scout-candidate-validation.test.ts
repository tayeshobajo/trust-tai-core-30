import { describe, expect, it } from "vitest";

import {
  acceptCandidates,
  discoveryEvaluation,
  rootDomain,
  type RawDiscoveryCandidate,
} from "./scout-candidate-validation";

const evidence = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ statement: `Fact ${i}`, source_url: "https://a.com" }));

function candidate(overrides: Partial<RawDiscoveryCandidate> = {}): RawDiscoveryCandidate {
  return {
    company_name: "Acme Systems",
    website: "https://www.acme.com/about",
    source_urls: ["https://acme.com"],
    observed_evidence: evidence(3),
    discovery_reason: "Managed IT provider in the target city.",
    icp_fit: { light: "green", score: 82, confidence: "high", reasoning: "Strong match.", criteria: [] },
    ...overrides,
  };
}

describe("rootDomain", () => {
  it("normalizes to a bare root domain", () => {
    expect(rootDomain("https://www.Acme.com/about")).toBe("acme.com");
    expect(rootDomain("acme.com")).toBe("acme.com");
  });

  it("rejects values that are not domains", () => {
    expect(rootDomain("not a website")).toBeNull();
    expect(rootDomain("")).toBeNull();
    expect(rootDomain(null)).toBeNull();
  });
});

describe("acceptCandidates", () => {
  it("keeps verifiable companies", () => {
    const { accepted, rejected } = acceptCandidates([candidate()]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.domain).toBe("acme.com");
    expect(rejected).toBe(0);
  });

  it("drops a company with no source evidence", () => {
    const { accepted, rejected } = acceptCandidates([candidate({ source_urls: [] })]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  it("drops a company with no resolvable website", () => {
    const { accepted, rejected } = acceptCandidates([candidate({ website: "unknown" })]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  it("de-duplicates by root domain, first occurrence wins", () => {
    const { accepted, duplicates } = acceptCandidates([
      candidate(),
      candidate({ website: "http://acme.com", company_name: "Acme (dupe)" }),
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.candidate.company_name).toBe("Acme Systems");
    expect(duplicates).toBe(1);
  });
});

describe("discoveryEvaluation", () => {
  const at = "2026-01-01T00:00:00.000Z";

  it("carries score, reasoning and citations through", () => {
    const result = discoveryEvaluation(candidate(), { icpVersion: 4, at });
    expect(result["score"]).toBe(82);
    expect(result["light"]).toBe("green");
    expect(result["icpVersion"]).toBe(4);
    expect(result["explanation"]).toBe("Strong match.");
  });

  it("never lets thin evidence read green", () => {
    const result = discoveryEvaluation(candidate({ observed_evidence: evidence(1) }), {
      icpVersion: 1,
      at,
    });
    expect(result["light"]).toBe("yellow");
  });

  it("clamps an out-of-range score", () => {
    const result = discoveryEvaluation(
      candidate({ icp_fit: { light: "red", score: 512, confidence: "low", reasoning: "", criteria: [] } }),
      { icpVersion: null, at },
    );
    expect(result["score"]).toBe(100);
  });

  it("maps an unknown criterion to missing, not a mismatch", () => {
    const result = discoveryEvaluation(
      candidate({
        icp_fit: {
          light: "yellow",
          score: 40,
          confidence: "low",
          reasoning: "Mixed.",
          criteria: [
            { name: "Budget", weight: 20, status: "unknown", score_contribution: 0, evidence: "Not published.", source_urls: [], confidence: "unknown" },
            { name: "Industry", weight: 20, status: "met", score_contribution: 20, evidence: "Stated on site.", source_urls: ["https://acme.com"], confidence: "high" },
          ],
        },
      }),
      { icpVersion: 2, at },
    );
    const criteria = result["criteria"] as Array<Record<string, unknown>>;
    expect(criteria[0]?.["state"]).toBe("missing");
    expect(criteria[1]?.["state"]).toBe("met");
    expect(criteria[1]?.["key"]).toBe("industry");
  });
});
