import { describe, expect, it } from "vitest";

import type { RoadmapMilestone, RoadmapStrategy, StrategyItem } from "@/domain/roadmap-intel";
import { freshness } from "@/domain/roadmap-intel";
import { buildOrder, rankMilestones, readiness, scoreMilestone } from "./roadmap-milestones";
import { normalizeResearch, normalizeSources } from "./roadmap-research-parse";

const PROV = { provider: "openai", model: "gpt-5-mini", checkedAt: "2026-01-05T00:00:00.000Z" };

const source = { label: "About", url: "https://acme.com/about", checkedAt: PROV.checkedAt };

function milestone(overrides: Partial<RoadmapMilestone> = {}): RoadmapMilestone {
  return {
    id: "m1",
    organizationId: "org",
    roadmapId: "r1",
    name: "Client portal",
    whatWeBuild: "A portal",
    intendedUser: "Operations leads",
    supportingMarketDirection: "Self-serve is expected",
    clientAdvantage: "They already own the data",
    currentGap: "Everything runs through email",
    evidence: [source],
    immediateValue: "Fewer email threads",
    longTermValue: "A data spine",
    dependencies: [],
    executionBoundary: "No billing integration",
    confidence: "high",
    priorityScore: 90,
    priorityRationale: [],
    recommendedSequence: 1,
    status: "approved",
    tier: "decided",
    ownerLabel: "Tai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function item(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    key: "k",
    statement: "They serve regional operators.",
    because: "Stated on their own site.",
    tier: "decided",
    confidence: "high",
    sources: [source],
    approval: "approved",
    ...overrides,
  };
}

function strategy(overrides: Partial<RoadmapStrategy> = {}): RoadmapStrategy {
  return {
    id: "s1",
    organizationId: "org",
    roadmapId: "r1",
    pointA: [item({ key: "a" })],
    anchorProof: [item({ key: "anchor", statement: "Twelve years of field crews." })],
    horizon: [],
    pointB: item({ key: "b", statement: "Own the intake experience." }),
    pointC: item({ key: "c", statement: "Become the record system for the region." }),
    centralTruth: item({ key: "truth", statement: "The work is trusted; the front door is not." }),
    gaps: [item({ key: "gap", statement: "No competitor publishes real availability." })],
    leveragePoint: item({ key: "lev", statement: "Their crew data is already structured." }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("scoreMilestone", () => {
  it("rewards sourced, market-aligned, bounded work", () => {
    const result = scoreMilestone({
      ...milestone(),
      evidence: [
        source,
        { ...source, url: "https://acme.com/news" },
        { ...source, url: "https://acme.com/careers" },
      ],
    });
    expect(result.priorityScore).toBe(100);
    expect(result.priorityRationale.join(" ")).toContain("3 sourced references");
  });

  it("cannot rank a claim above its confidence", () => {
    const result = scoreMilestone({ ...milestone(), confidence: "unknown" });
    expect(result.priorityScore).toBeLessThanOrEqual(40);
    expect(result.priorityRationale.some((line) => line.includes("Held at 40"))).toBe(true);
  });

  it("says plainly when there is no evidence", () => {
    const result = scoreMilestone({ ...milestone(), evidence: [] });
    expect(result.priorityRationale[0]).toContain("No sourced evidence");
  });

  it("penalises dependencies", () => {
    const withDeps = scoreMilestone({ ...milestone(), dependencies: ["CRM access", "Brand kit"] });
    const without = scoreMilestone(milestone());
    expect(withDeps.priorityScore).toBeLessThan(without.priorityScore);
  });
});

describe("rankMilestones", () => {
  it("orders by score then by fewer dependencies", () => {
    const ranked = rankMilestones([
      {
        ...milestone({ name: "Weak" }),
        evidence: [],
        supportingMarketDirection: "",
        confidence: "low",
      },
      { ...milestone({ name: "Strong" }) },
    ]);
    expect(ranked[0]!.name).toBe("Strong");
    expect(ranked[0]!.recommendedSequence).toBe(1);
    expect(ranked[1]!.recommendedSequence).toBe(2);
  });
});

describe("buildOrder", () => {
  it("shows approved and decided milestones only", () => {
    const list = [
      milestone({ id: "a" }),
      milestone({ id: "b", status: "shortlisted" }),
      milestone({ id: "c", status: "approved", tier: "inferred" }),
    ];
    expect(buildOrder(list).map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("readiness", () => {
  it("blocks unapproved work", () => {
    expect(readiness(milestone({ status: "candidate" })).ready).toBe(false);
  });
  it("blocks open dependencies", () => {
    expect(readiness(milestone({ dependencies: ["CRM access"] })).because).toContain("dependency");
  });
  it("blocks unowned work", () => {
    const bare = milestone();
    delete (bare as { ownerLabel?: string }).ownerLabel;
    expect(readiness(bare).because).toContain("No one is named");
  });
  it("passes approved, unblocked, owned work", () => {
    expect(readiness(milestone()).ready).toBe(true);
  });
});

describe("normalizeResearch", () => {
  it("marks a claim observed only when it carries a real source", () => {
    const result = normalizeResearch(
      {
        company_model: [
          {
            statement: "Sells to regional operators",
            sources: [{ url: "https://acme.com", label: "Home" }],
          },
          { statement: "Probably expanding", confidence: "high" },
        ],
      },
      PROV,
    );
    expect(result.companyModel[0]!.tier).toBe("observed");
    expect(result.companyModel[1]!.tier).toBe("inferred");
    expect(result.companyModel[1]!.confidence).toBe("low");
  });

  it("names empty sections as unknowns rather than dropping them", () => {
    const result = normalizeResearch({}, PROV);
    expect(result.unknowns.length).toBeGreaterThanOrEqual(6);
  });

  it("rolls every claim source up and de-duplicates", () => {
    const result = normalizeResearch(
      {
        buyers: [{ statement: "Ops leads", sources: [{ url: "https://acme.com/x" }] }],
        strengths: [{ statement: "Field crews", sources: [{ url: "https://acme.com/x" }] }],
      },
      PROV,
    );
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.provider).toBe("openai");
  });

  it("rejects non-http sources", () => {
    expect(normalizeSources([{ url: "not-a-url" }], PROV)).toHaveLength(0);
  });
});

describe("freshness", () => {
  it("reads in plain language", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    expect(freshness(undefined, now)).toBe("Never researched");
    expect(freshness("2026-01-10T00:00:00.000Z", now)).toBe("Checked today");
    expect(freshness("2026-01-09T00:00:00.000Z", now)).toBe("Checked yesterday");
    expect(freshness("2025-11-10T00:00:00.000Z", now)).toContain("months ago");
  });
});
