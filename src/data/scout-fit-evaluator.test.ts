import { describe, expect, it } from "vitest";

import { evaluateScoutFit } from "./scout-fit-evaluator";

type Obs = { key: string; label: string; value: unknown; evidence?: string; source_url?: string };

function obs(key: string, value: unknown, evidence = "", sourceUrl = "https://example.com/page"): Obs {
  return { key, label: key, value, evidence, source_url: sourceUrl };
}

const base = { inferred: {}, suggested: {}, scoreable: true, icpVersion: 1, at: "2026-01-01T00:00:00.000Z" };

describe("scout fit evaluator v2 — structured v3 observations", () => {
  it("scores strong structured evidence green only with >=75 and >=3 met criteria", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [
        obs("active_business_signals", 5, "Services, hours, and client work are published"),
        obs("proof_signals", 4, "Four named case studies"),
        obs("testimonial_signals", true),
        obs("case_study_signals", true),
        obs("clear_offer_signals", true, "Three service packages described"),
        obs("pricing_signal", true),
        obs("decision_maker_signals", 2, "Founder Jane Doe, Director Sam Lee"),
        obs("contact_routes", 3, "Form, email, phone"),
        obs("booking_signal", false),
        obs("milestone_opportunities", ["Add a booking path", "Rebuild the case-study library"], "No booking despite services"),
        obs("pages_researched", 6),
      ],
      pagesResearched: 6,
      researchVersion: 3,
    });

    expect(result.light).toBe("green");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.evidenceCount).toBeGreaterThanOrEqual(3);
    expect(result.researchDepthNote).toBe("6 public pages checked");
    expect(result.researchVersion).toBe(3);
  });

  it("keeps thin evidence yellow", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [
        obs("active_business_signals", 1, "One services page"),
        obs("proof_signals", 0),
        obs("clear_offer_signals", true, "Services listed"),
        obs("contact_routes", 1, "Contact form"),
        obs("decision_maker_signals", 0),
        obs("pages_researched", 2),
      ],
      pagesResearched: 2,
      researchVersion: 3,
    });

    expect(result.light).toBe("yellow");
    expect(result.evidenceCount).toBeLessThan(3);
    expect(result.researchDepthNote).toBe("Research depth is thin");
  });

  it("does not turn missing proof into red", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [
        obs("active_business_signals", 3, "Services, hours, locations"),
        obs("proof_signals", 0),
        obs("testimonial_signals", false),
        obs("clear_offer_signals", true, "Offer described"),
        obs("contact_routes", 2, "Form and email"),
      ],
      researchVersion: 3,
    });

    expect(result.light).not.toBe("red");
    const proven = result.criteria.find((c) => c.key === "proven");
    expect(proven?.state).toBe("missing");
  });

  it("treats a named decision maker without a contact route as partial only", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [obs("decision_maker_signals", 1, "Founder Jane Doe"), obs("contact_routes", 0)],
    });
    const criterion = result.criteria.find((c) => c.key === "decision_maker");
    expect(criterion?.state).toBe("partial");
    expect(criterion?.reason).toMatch(/human confirmation/i);
  });

  it("never treats WordPress alone as a system gap", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [
        obs("wordpress_detected", true, "wp-content asset paths"),
        obs("active_business_signals", 2),
        obs("clear_offer_signals", true),
        obs("contact_routes", 2, "Form and phone"),
        obs("booking_signal", true),
        obs("proof_signals", 2, "Two case studies"),
        obs("milestone_opportunities", []),
      ],
    });
    const gap = result.criteria.find((c) => c.key === "limiting_system");
    expect(gap?.state).toBe("missing");
    expect(gap?.score).toBe(0);
  });

  it("ignores the generic milestone fallback", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [obs("milestone_opportunities", ["Deeper human review before proposing a milestone"])],
    });
    expect(result.criteria.find((c) => c.key === "first_milestone")?.state).toBe("missing");
    expect(result.criteria.find((c) => c.key === "roadmap_depth")?.state).toBe("missing");
  });

  it("keeps funding capacity conservative", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [obs("pricing_signal", true), obs("organization_schema", 2), obs("wordpress_detected", true)],
    });
    const funding = result.criteria.find((c) => c.key === "funding_capacity");
    expect(funding?.state).toBe("partial");
  });

  it("leaves preview demo rows neutral", () => {
    const result = evaluateScoutFit({ ...base, observed: [], scoreable: false });
    expect(result.light).toBe("neutral");
    expect(result.score).toBe(0);
    expect(result.scoreable).toBe(false);
  });

  it("still evaluates legacy v1/v2 keyword rows", () => {
    const result = evaluateScoutFit({
      ...base,
      observed: [
        { key: "s1", label: "", value: "Services page lists three offerings for clients", evidence: "Services page" },
        { key: "s2", label: "", value: "Testimonials from two named clients", evidence: "Testimonials" },
      ],
    });
    expect(result.scoreable).toBe(true);
    expect(result.criteria.length).toBeGreaterThan(0);
  });
});
