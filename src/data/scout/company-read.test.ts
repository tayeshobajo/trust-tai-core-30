/**
 * Scout's company read pilot, pinned.
 *
 * One read per company: it reuses what Scout already retrieved and the people
 * already resolved canonically, never invents identity, never promotes its own
 * inference to observation, keeps unreadable sources withheld, and writes
 * nothing.
 */

import { describe, expect, it } from "vitest";

import type { IntelligenceCase } from "@/domain/intelligence-canon";
import { composeScoutRetrieval } from "@/lib/scout-retrieval";

import { composeScoutCompanyRead } from "./company-read";

const NOW = "2026-09-09T10:00:00.000Z";

const subject = { type: "prospect", id: "prospect-1", label: "Northfield Dental" };

function correction(): IntelligenceCase {
  return {
    id: "case-1",
    organizationId: "org-1",
    patternId: "wrong_domain",
    patternVersion: 1,
    entities: [],
    evidenceRefs: [],
    hypothesis: "Northfield Dental sits at northfield.com.",
    humanDecision: "It is northfielddental.com.",
    decidedBy: "user-1",
    decidedAt: NOW,
    correction: "Northfield Dental is northfielddental.com, not northfield.com.",
    lesson: "Confirm the domain from the source, never from the name.",
    diagnosisVerdict: "incorrect",
    createdAt: NOW,
  };
}

const bundle = () =>
  composeScoutRetrieval({
    organizationId: "org-1",
    now: NOW,
    subject: "Northfield Dental",
    known: [{ name: "Northfield Dental", domain: "northfielddental.com", intent: "Referral" }],
    observed: [{ statement: "Six locations listed", sourceUrl: "https://northfielddental.com" }],
    derived: ["They may be growing."],
    decided: ["Active ICP governs fit."],
    withheld: [{ appId: "icp_profiles", reason: "no_data" }],
  });

describe("composeScoutCompanyRead", () => {
  it("reads one company from the existing retrieval bundle", () => {
    const read = composeScoutCompanyRead({ bundle: bundle(), subject });
    expect(read.room).toBe("scout");
    expect(read.organizationId).toBe("org-1");
    expect(read.subject.id).toBe("prospect-1");
    expect(read.asOf).toBe(NOW);
    expect(read.claims.length).toBeGreaterThan(0);
  });

  it("keeps Scout's own reading inferred, never observed", () => {
    const read = composeScoutCompanyRead({ bundle: bundle(), subject });
    const derived = read.claims.find((claim) => claim.id === "scout:derived:0");
    expect(derived?.tier).toBe("inferred");
    expect(derived?.because).toBeTruthy();
    const decided = read.claims.find((claim) => claim.tier === "decided");
    expect(decided?.origin).toBe("human");
  });

  it("reuses canonically resolved people instead of inventing one", () => {
    const read = composeScoutCompanyRead({
      bundle: bundle(),
      subject,
      people: [
        {
          id: "contact-9",
          name: "Tai",
          title: "Founder",
          email: "tai@example.com",
          sourceLabel: "Canonical contact record",
          at: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    const person = read.claims.find((claim) => claim.aspect === "person");
    expect(person?.id).toBe("scout:resolved-person:contact-9");
    expect(person?.tier).toBe("observed");
    expect(person?.origin).toBe("observed");
    expect(person?.sources[0]?.label).toBe("Canonical contact record");
    expect(person?.statement).toContain("Founder");
  });

  it("says nothing about a person when none is resolved", () => {
    const read = composeScoutCompanyRead({
      bundle: bundle(),
      subject,
      unknowns: ["No person is known for this company yet."],
    });
    expect(read.claims.some((claim) => claim.aspect === "person")).toBe(false);
    expect(read.unknowns).toEqual(["No person is known for this company yet."]);
  });

  it("lets a human correction outrank the inference it corrects", () => {
    const read = composeScoutCompanyRead({
      bundle: composeScoutRetrieval({
        organizationId: "org-1",
        now: NOW,
        subject: "Northfield Dental",
        derived: ["Northfield Dental sits at northfield.com."],
        cases: [correction()],
      }),
      subject,
      aspects: { "scout:derived:0": "domain", "case:case-1": "domain" },
    });
    const domain = read.claims.find((claim) => claim.aspect === "domain");
    expect(domain?.tier).toBe("decided");
    expect(domain?.statement).toContain("northfielddental.com");
    const conflict = read.conflicts.find((entry) => entry.aspect === "domain");
    expect(conflict?.losing[0]?.statement).toContain("northfield.com");
    expect(conflict?.losing[0]?.tier).toBe("inferred");
  });

  it("carries unreadable sources as withheld, never as zero", () => {
    const read = composeScoutCompanyRead({ bundle: bundle(), subject });
    expect(read.withheld).toEqual([{ appId: "icp_profiles", reason: "no_data" }]);
  });

  it("stays deterministic unless a model actually reasoned", () => {
    expect(composeScoutCompanyRead({ bundle: bundle(), subject }).producedBy).toBe("deterministic");
    expect(
      composeScoutCompanyRead({ bundle: bundle(), subject, reasonedByModel: true }).producedBy,
    ).toBe("mixed");
  });

  it("is pure: the same bundle read twice gives the same answer", () => {
    const input = bundle();
    const first = composeScoutCompanyRead({ bundle: input, subject });
    const second = composeScoutCompanyRead({ bundle: input, subject });
    expect(second).toEqual(first);
    expect(input.evidence).toHaveLength(4);
  });
});
