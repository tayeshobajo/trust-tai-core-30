import { describe, expect, it } from "vitest";

import { buildAccountBrief } from "./account-brief";
import { buildPersonPlan, recommendPerson } from "./person-priority";
import { buildGapPlan } from "./scout-gaps";
import { byPriority, computeDecisionMetrics, readScoutIntel, writeScoutIntel } from "./scout-intel";
import type { Person } from "@/domain/people";
import type { ProspectCandidate } from "@/domain/scout";
import type { ScoutFitEvaluation } from "@/domain/scout-fit";
import { EMPTY_INTEL, type ScoutIntel } from "@/domain/scout-intel";

const AT = "2026-03-01T00:00:00.000Z";
const NOW = new Date("2026-03-02T00:00:00.000Z");

function evaluation(overrides: Partial<ScoutFitEvaluation> = {}): ScoutFitEvaluation {
  return {
    score: 78,
    light: "green",
    evidenceCount: 5,
    strongestSignal: "Four named case studies are published.",
    criteria: [
      {
        key: "proof",
        label: "Proof of work",
        score: 20,
        maxScore: 20,
        state: "met",
        reason: "Four case studies with named clients.",
        sourceUrls: ["https://acme.test/work"],
      },
      {
        key: "decision_maker",
        label: "Decision maker",
        score: 0,
        maxScore: 15,
        state: "missing",
        reason: "No named leadership was found on the public site.",
      },
    ],
    icpVersion: 3,
    evaluatorVersion: "trust-tai-icp-v3",
    evaluatedAt: AT,
    explanation: "Strong published proof against ICP v3.",
    scoreable: true,
    ...overrides,
  };
}

function candidate(overrides: Partial<ProspectCandidate> = {}): ProspectCandidate {
  return {
    prospect: {
      id: "p1",
      organizationId: "org",
      name: "Acme Digital",
      domain: "acme.test",
      websiteUrl: "https://acme.test",
      status: "discovered",
      createdAt: AT,
      updatedAt: AT,
    },
    signals: [],
    fit: { whyItFits: "Looks like our retained clients.", recommendation: "Research further." },
    source: { kind: "live_website", label: "AI market discovery" },
    evaluation: evaluation(),
    lastCheckedAt: AT,
    ...overrides,
  };
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "c1",
    organizationId: "org",
    fullName: "Jane Doe",
    roleTitle: "Founder",
    seniority: "founder",
    emailStatus: "unknown",
    confidence: "observed",
    sourceId: "scout_discovery",
    provenance: { appId: "scout", actor: { type: "intelligence", id: "scout" }, observedAt: AT },
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

const richIntel: ScoutIntel = {
  buyingSignals: [
    {
      type: "hiring",
      statement: "Hiring two marketing roles.",
      sourceUrl: "https://acme.test/careers",
      observedAt: "2026-02-01T00:00:00.000Z",
    },
  ],
  opportunities: [
    {
      area: "conversion",
      statement: "No enquiry path on the services pages.",
      evidence: "Services pages end without a form or a call to action.",
      sourceUrl: "https://acme.test/services",
    },
  ],
  people: [],
  unknowns: ["Headcount was not stated anywhere public."],
  citations: ["https://acme.test", "https://acme.test/about"],
  collectedAt: AT,
};

describe("intel storage", () => {
  it("round-trips through the stored metadata shape", () => {
    const stored = { scout_intel: writeScoutIntel(richIntel) };
    const read = readScoutIntel(stored);
    expect(read.buyingSignals[0]?.statement).toBe("Hiring two marketing roles.");
    expect(read.opportunities[0]?.area).toBe("conversion");
    expect(read.citations).toHaveLength(2);
  });

  it("returns an honest empty read for rows that were never enriched", () => {
    expect(readScoutIntel({}).buyingSignals).toEqual([]);
    expect(readScoutIntel(null).opportunities).toEqual([]);
  });

  it("keeps an unrecognised opportunity area from breaking the read", () => {
    const read = readScoutIntel({
      scout_intel: { opportunities: [{ area: "vibes", statement: "Feels dated", evidence: "" }] },
    });
    expect(read.opportunities[0]?.area).toBe("ux");
  });
});

describe("decision metrics", () => {
  it("reports six separate reads rather than one blended number", () => {
    const metrics = computeDecisionMetrics({
      candidate: candidate(),
      intel: richIntel,
      people: [person({ email: "jane@acme.test", emailStatus: "verified" })],
      now: NOW,
    });
    expect(metrics.metrics).toHaveLength(6);
    expect(metrics.metrics.every((metric) => metric.because.length > 0)).toBe(true);
  });

  it("never ranks a record that was never researched", () => {
    const metrics = computeDecisionMetrics({
      candidate: candidate({
        evaluation: evaluation({ scoreable: false, score: 0, light: "neutral" }),
      }),
      intel: EMPTY_INTEL,
      people: [],
      now: NOW,
    });
    expect(metrics.priority).toBeNull();
    expect(metrics.metrics.find((m) => m.key === "icp_match")?.value).toBeNull();
  });

  it("treats a missing buying signal as unknown, not as a negative", () => {
    const metrics = computeDecisionMetrics({
      candidate: candidate(),
      intel: EMPTY_INTEL,
      people: [],
      now: NOW,
    });
    const timing = metrics.metrics.find((metric) => metric.key === "timing");
    expect(timing?.value).toBe(0);
    expect(timing?.because).toContain("Unknown, not negative");
  });

  it("scores a verified email higher than an unverified one", () => {
    const withVerified = computeDecisionMetrics({
      candidate: candidate(),
      intel: richIntel,
      people: [person({ email: "jane@acme.test", emailStatus: "verified" })],
      now: NOW,
    });
    const withFound = computeDecisionMetrics({
      candidate: candidate(),
      intel: richIntel,
      people: [person({ email: "jane@acme.test", emailStatus: "found" })],
      now: NOW,
    });
    expect(withVerified.priority!).toBeGreaterThan(withFound.priority!);
  });

  it("explains the priority arithmetic in plain language", () => {
    const metrics = computeDecisionMetrics({
      candidate: candidate(),
      intel: richIntel,
      people: [],
      now: NOW,
    });
    expect(metrics.priorityExplanation).toContain("ICP match 78 × 0.3");
  });

  it("sorts unranked records last, never first", () => {
    const sorted = [{ priority: null }, { priority: 40 }, { priority: 90 }].sort(byPriority);
    expect(sorted.map((entry) => entry.priority)).toEqual([90, 40, null]);
  });

  it("discounts an old signal against a recent one", () => {
    const stale = computeDecisionMetrics({
      candidate: candidate(),
      intel: {
        ...richIntel,
        buyingSignals: [
          { type: "hiring", statement: "Hired in 2019.", observedAt: "2019-01-01T00:00:00.000Z" },
        ],
      },
      people: [],
      now: NOW,
    });
    const timing = stale.metrics.find((metric) => metric.key === "timing");
    expect(timing?.value).toBe(35);
  });
});

describe("person priority", () => {
  it("puts the founder with a verified email first", () => {
    const plan = buildPersonPlan([
      person({ id: "a", fullName: "Sam Ops", seniority: "operations" }),
      person({
        id: "b",
        fullName: "Jane Doe",
        seniority: "founder",
        email: "jane@acme.test",
        emailStatus: "verified",
      }),
    ]);
    expect(plan.primary?.fullName).toBe("Jane Doe");
    expect(plan.primary?.route).toBe("verified_email");
    expect(plan.gap).toBeNull();
  });

  it("names the gap when the best route is an unverified address", () => {
    const plan = buildPersonPlan([person({ email: "jane@acme.test", emailStatus: "found" })]);
    expect(plan.gap).toContain("has not been verified");
  });

  it("says so when nobody on record decides", () => {
    const plan = buildPersonPlan([person({ seniority: "operations" })]);
    expect(plan.gap).toContain("Nobody on record clearly decides");
  });

  it("prefers a human-confirmed record over a provider assertion", () => {
    const confirmed = recommendPerson(person({ confidence: "human_confirmed" }));
    const asserted = recommendPerson(person({ confidence: "asserted_by_provider" }));
    expect(confirmed.weight).toBeGreaterThan(asserted.weight);
  });

  it("returns no primary and a clear reason when nobody is known", () => {
    const plan = buildPersonPlan([]);
    expect(plan.primary).toBeNull();
    expect(plan.gap).toContain("No person has been found");
  });
});

describe("account brief", () => {
  it("builds an evidence-backed brief with sources", () => {
    const plan = buildPersonPlan([person({ email: "jane@acme.test", emailStatus: "verified" })]);
    const brief = buildAccountBrief({ candidate: candidate(), intel: richIntel, plan });
    expect(brief.grounded).toBe(true);
    expect(brief.sections.map((section) => section.id)).toContain("why_now");
    expect(
      brief.sections.find((section) => section.id === "evidence")?.sources.length,
    ).toBeGreaterThan(0);
  });

  it("labels the suggested angle as an inference, never as a fact", () => {
    const brief = buildAccountBrief({
      candidate: candidate(),
      intel: richIntel,
      plan: buildPersonPlan([person()]),
    });
    expect(brief.sections.find((section) => section.id === "angle")?.tier).toBe("inference");
  });

  it("refuses to invent a hook when nothing was observed", () => {
    const brief = buildAccountBrief({
      candidate: candidate(),
      intel: EMPTY_INTEL,
      plan: buildPersonPlan([]),
    });
    const angle = brief.sections.find((section) => section.id === "angle");
    expect(angle?.body).toContain("no honest hook");
  });

  it("reads as ungrounded when the company was never researched", () => {
    const brief = buildAccountBrief({
      candidate: candidate({ evaluation: evaluation({ scoreable: false, evidenceCount: 0 }) }),
      intel: EMPTY_INTEL,
      plan: buildPersonPlan([]),
    });
    expect(brief.grounded).toBe(false);
  });

  it("surfaces unknowns rather than hiding them", () => {
    const brief = buildAccountBrief({
      candidate: candidate(),
      intel: richIntel,
      plan: buildPersonPlan([]),
    });
    expect(brief.sections.find((section) => section.id === "unknowns")?.body).toContain(
      "Headcount",
    );
  });
});

describe("gap plan", () => {
  it("asks for research first on a record that was never researched", () => {
    const plan = buildGapPlan({
      candidate: candidate({ evaluation: evaluation({ scoreable: false }) }),
      intel: EMPTY_INTEL,
      plan: buildPersonPlan([]),
    });
    expect(plan.gaps[0]?.key).toBe("research");
    expect(plan.actionable).toBe(true);
  });

  it("names an unknown criterion as a gap Scout can close itself", () => {
    const plan = buildGapPlan({
      candidate: candidate(),
      intel: richIntel,
      plan: buildPersonPlan([person({ email: "j@acme.test", emailStatus: "verified" })]),
    });
    expect(plan.gaps.some((gap) => gap.key === "criterion:decision_maker")).toBe(true);
  });

  it("marks verification as needing a person or provider", () => {
    const plan = buildGapPlan({
      candidate: candidate(),
      intel: richIntel,
      plan: buildPersonPlan([person({ email: "j@acme.test", emailStatus: "found" })]),
    });
    expect(plan.gaps.find((gap) => gap.key === "verification")?.autonomous).toBe(false);
  });
});
