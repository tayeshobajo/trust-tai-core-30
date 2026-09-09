/**
 * Candidate ranking — the identity-confidence gate.
 *
 * These cases moved here from `linki-provider.server.test.ts` when the Linki
 * lookup was removed (2026-09-09). The ranking never depended on Linki, and the
 * wrong-person shields pinned below are the whole reason a human is shown a
 * shortlist instead of a guess. They are worth keeping regardless of who feeds
 * the candidates.
 */

import { describe, expect, it } from "vitest";

import {
  NO_CONFIDENT_MATCH_REASON,
  normalizeName,
  rankCandidates,
  type LinkedinCandidate,
} from "@/lib/linkedin-candidates";

describe("normalizeName (search tokens must be clean)", () => {
  it("folds the several dashes LinkedIn and CRMs disagree about", () => {
    expect(normalizeName("Anne‑Marie Dupont")).toBe("Anne-Marie Dupont");
  });

  it("folds full-width characters down to ASCII", () => {
    expect(normalizeName("Ｉｓａａｃ Meek")).toBe("Isaac Meek");
  });

  it("collapses stray whitespace", () => {
    expect(normalizeName("  Isaac \n\t  Meek ")).toBe("Isaac Meek");
  });
});

describe("rankCandidates (evidence ranking + fail closed)", () => {
  const person = {
    fullName: "Isaac Meek",
    companyName: "Acme Insurance Group",
    roleTitle: "Owner",
    location: "Nashville",
    companyDomain: "acme.com",
  };

  const mk = (over: Partial<LinkedinCandidate>): LinkedinCandidate => ({
    linkedinUrl: "https://www.linkedin.com/in/isaac-meek",
    fullName: "Isaac Meek",
    headline: null,
    location: null,
    degree: null,
    company: null,
    ...over,
  });

  it("ranks the candidate with more evidence first", () => {
    const weak = mk({ linkedinUrl: "https://www.linkedin.com/in/weak", company: "Other Co" });
    const strong = mk({ company: "Acme Insurance", headline: "Owner", location: "Nashville" });
    const { ranked } = rankCandidates(person, [weak, strong]);
    expect(ranked[0]?.company).toBe("Acme Insurance");
  });

  it("refuses a name match with no supporting evidence", () => {
    const { ranked, noMatchReason } = rankCandidates(person, [mk({})]);
    expect(ranked).toEqual([]);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
  });

  it("refuses an empty candidate list rather than inventing one", () => {
    const { ranked, noMatchReason } = rankCandidates(person, []);
    expect(ranked).toEqual([]);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
  });

  it("shields against a near-miss surname, however strong the other evidence", () => {
    const { ranked, noMatchReason } = rankCandidates(person, [
      mk({
        fullName: "Isaac Meeks",
        company: "Acme Insurance",
        headline: "Owner",
        location: "Nashville",
      }),
    ]);
    expect(ranked).toEqual([]);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
  });

  it("explains itself — every offered candidate carries its evidence", () => {
    const { ranked } = rankCandidates(person, [
      mk({ company: "Acme Insurance", headline: "Owner" }),
    ]);
    expect(ranked[0]?.why.some((w) => w.startsWith("Company match"))).toBe(true);
    expect(ranked[0]?.why.some((w) => w.startsWith("Role match"))).toBe(true);
  });
});
