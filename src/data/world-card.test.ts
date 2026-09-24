import { describe, expect, it } from "vitest";

import { composeWorldCard, worldCardForStorage, worldCardSummary } from "./world-card";
import { checkIntroTruth, unknownsDominate, worldCardEvidenceCount } from "@/domain/world-card";
import type { ScoutFitEvaluation } from "@/domain/scout-fit";

/** A realistic researched prospect: Mental-Dental shaped. */
const RICH_METADATA = {
  scout_intel: {
    buying_signals: [
      {
        type: "launch",
        statement: "Announced a second clinic location opening in Austin",
        source_url: "https://mentaldental.example/news",
        observed_at: "2026-09-01",
      },
      {
        type: "hiring",
        statement: "Hiring two associate dentists and a front-office lead",
        source_url: "https://mentaldental.example/careers",
      },
    ],
    opportunities: [
      {
        area: "conversion",
        statement: "Online booking is a phone-only fallback form",
        evidence: "The Book Now button opens a mailto link",
        source_url: "https://mentaldental.example/book",
      },
    ],
    unknowns: ["Whether the practice owner makes technology decisions"],
    collected_at: "2026-09-20T00:00:00.000Z",
    citations: [],
    people: [],
  },
};

const RICH_OBSERVED = [
  {
    key: "active_business_signals",
    evidence: "Full appointment calendar and five-location expansion plan on the About page",
    value: true,
    source_url: "https://mentaldental.example/about",
  },
  {
    key: "proof_signals",
    evidence: "Over 400 five-star patient reviews highlighted on the homepage",
    value: true,
    source_url: "https://mentaldental.example",
  },
  {
    key: "system_constraint",
    evidence: "The site is a 2017 template with no patient portal",
    value: true,
    source_url: "https://mentaldental.example",
  },
];

const RICH_EVALUATION: ScoutFitEvaluation = {
  score: 82,
  light: "green",
  evidenceCount: 6,
  strongestSignal: "Expansion with weak digital presence",
  criteria: [],
  icpVersion: 4,
  evaluatorVersion: "trust-tai-icp-v4",
  evaluatedAt: "2026-09-23T00:00:00.000Z",
  explanation: "Healthy business in motion with an observed digital gap.",
  scoreable: true,
  opportunityGap: {
    gap: "high",
    momentumEvidence: ["Announced a second clinic location opening in Austin"],
    maturityEvidence: ["Online booking is a phone-only fallback form"],
  },
};

describe("composeWorldCard", () => {
  it("composes every field from stored evidence, with sources", () => {
    const card = composeWorldCard({
      metadata: RICH_METADATA,
      observed: RICH_OBSERVED,
      evaluation: RICH_EVALUATION,
      now: "2026-09-24T00:00:00.000Z",
    });

    expect(card.building).toContain(
      "Full appointment calendar and five-location expansion plan on the About page",
    );
    expect(card.caresAbout).toContain(
      "Over 400 five-star patient reviews highlighted on the homepage",
    );
    expect(card.recentChanges).toContain(
      "Announced a second clinic location opening in Austin",
    );
    expect(card.visionOutgrewSystem).toContain("Online booking is a phone-only fallback form");
    expect(card.visionOutgrewSystem).toContain("The site is a 2017 template with no patient portal");
    expect(card.whyTrustTai).toHaveLength(1);
    expect(card.whyTrustTai[0]).toContain("moving");

    // Every entry on the card is backed by an evidence record with a source.
    const statements = new Set(card.evidence.map((entry) => entry.statement));
    for (const entry of [
      ...card.building,
      ...card.caresAbout,
      ...card.recentChanges,
      ...card.visionOutgrewSystem,
      ...card.whyTrustTai,
    ]) {
      expect(statements.has(entry)).toBe(true);
    }
    expect(card.evidence.every((entry) => entry.source.length > 0)).toBe(true);

    // Only the genuinely unknown remains in unknowns.
    expect(card.unknowns).toContain("Whether the practice owner makes technology decisions");
    expect(unknownsDominate(card)).toBe(false);
    expect(card.intelCollectedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(card.evaluatorVersion).toBe("trust-tai-icp-v4");
  });

  it("leaves fields empty and names what is missing when evidence is thin", () => {
    const card = composeWorldCard({ metadata: {}, observed: [], evaluation: null });

    expect(worldCardEvidenceCount(card)).toBe(0);
    expect(card.evidence).toHaveLength(0);
    expect(card.unknowns.length).toBeGreaterThanOrEqual(5);
    expect(card.unknowns.join(" ")).toContain("not been observed");
    expect(unknownsDominate(card)).toBe(true);
  });

  it("does not claim a reason to talk when the gap is low or unknown", () => {
    const card = composeWorldCard({
      metadata: RICH_METADATA,
      observed: RICH_OBSERVED,
      evaluation: {
        ...RICH_EVALUATION,
        opportunityGap: { gap: "low", momentumEvidence: [], maturityEvidence: ["Modern site"] },
      },
    });
    expect(card.whyTrustTai).toHaveLength(0);
    expect(card.unknowns.join(" ")).toContain("no proven reason to reach out");
  });

  it("serializes for jsonb storage in snake_case with provenance stamps", () => {
    const card = composeWorldCard({
      metadata: RICH_METADATA,
      observed: RICH_OBSERVED,
      evaluation: RICH_EVALUATION,
      now: "2026-09-24T00:00:00.000Z",
    });
    const stored = worldCardForStorage(card);
    expect(stored["composed_at"]).toBe("2026-09-24T00:00:00.000Z");
    expect(stored["evaluator_version"]).toBe("trust-tai-icp-v4");
    expect(Array.isArray(stored["why_trust_tai"])).toBe(true);
    expect(worldCardSummary(card)).toMatch(/building:\d+ cares:\d+/);
  });
});

describe("checkIntroTruth", () => {
  const card = composeWorldCard({
    metadata: RICH_METADATA,
    observed: RICH_OBSERVED,
    evaluation: RICH_EVALUATION,
  });

  it("passes a draft whose claims trace to card evidence", () => {
    const body =
      "Hi Dana. I saw you announced a second clinic location in Austin. " +
      "Congrats on the expansion. If useful, I help practices whose booking still runs on forms. " +
      "No pressure either way.";
    expect(checkIntroTruth(body, card).passes).toBe(true);
  });

  it("rejects claims with no evidence behind them", () => {
    const body = "Hi Dana. I noticed you just raised a large funding round for robotics.";
    const check = checkIntroTruth(body, card);
    expect(check.passes).toBe(false);
    expect(check.violations[0]?.kind).toBe("unevidenced_claim");
  });

  it("rejects unresolved placeholders", () => {
    const check = checkIntroTruth("Hi {{first_name}}, quick note about [COMPANY].", card);
    expect(check.passes).toBe(false);
    expect(check.violations.map((v) => v.kind)).toContain("unresolved_placeholder");
  });

  it("lets generic non-claim language through", () => {
    const check = checkIntroTruth(
      "Hello. I build websites for growing businesses. Happy to share examples.",
      card,
    );
    expect(check.passes).toBe(true);
  });
});
