/**
 * Tests for the Comms handoff draft.
 *
 * The draft decides who Comms opens with and whether the prospect is ready to
 * leave Scout at all. These tests pin the judgement calls: verified
 * decision-makers outrank everyone, unreachable people are still listed with
 * the reason, and a prospect with nobody to write to is blocked rather than
 * handed over hopefully.
 */

import { describe, expect, it } from "vitest";

import type { Person, Seniority } from "@/domain/people";

import { buildHandoffDraft, selectTargets } from "./comms-handoff";

function person(overrides: Partial<Person> & { fullName: string }): Person {
  return {
    id: overrides.fullName.toLowerCase().replace(/\s+/g, "-"),
    organizationId: "org-1",
    prospectId: "prospect-1",
    seniority: "other" as Seniority,
    emailStatus: "unknown",
    confidence: "asserted_by_provider",
    sourceId: "website-people",
    provenance: {
      appId: "scout",
      observedAt: new Date().toISOString(),
      actor: { type: "system", id: "scout" },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Person;
}

const FOUNDER_VERIFIED = person({
  fullName: "Ada Rowe",
  roleTitle: "Founder",
  seniority: "founder",
  email: "ada@northbeam.example",
  emailStatus: "verified",
  confidence: "human_confirmed",
});

const FOUNDER_UNVERIFIED = person({
  fullName: "Jon Mears",
  roleTitle: "Co-founder",
  seniority: "founder",
  email: "jon@northbeam.example",
  emailStatus: "found",
});

const MARKETING = person({
  fullName: "Priya Shah",
  roleTitle: "Marketing Lead",
  seniority: "marketing",
  email: "priya@northbeam.example",
  emailStatus: "verified",
});

describe("selectTargets", () => {
  it("opens with the verified decision maker", () => {
    const targets = selectTargets([FOUNDER_UNVERIFIED, FOUNDER_VERIFIED]);

    expect(targets[0]?.fullName).toBe("Ada Rowe");
    expect(targets[0]?.rank).toBe("primary");
    expect(targets[0]?.blocker).toBeUndefined();
  });

  it("keeps unreachable decision makers as named fallbacks with the reason", () => {
    const targets = selectTargets([FOUNDER_VERIFIED, FOUNDER_UNVERIFIED]);

    const fallback = targets.find((target) => target.fullName === "Jon Mears");
    expect(fallback?.rank).toBe("alternate");
    expect(fallback?.blocker).toMatch(/nobody has confirmed/i);
  });

  it("says plainly when there is no address at all", () => {
    const targets = selectTargets([person({ fullName: "Sam Vale", seniority: "owner" })]);

    expect(targets[0]?.blocker).toMatch(/no business email/i);
  });

  it("does not offer people who cannot decide", () => {
    expect(selectTargets([MARKETING])).toHaveLength(0);
  });

  it("never marks an unreachable person as the one to open with", () => {
    const targets = selectTargets([FOUNDER_UNVERIFIED]);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.rank).toBe("alternate");
  });

  it("explains each target in plain language", () => {
    const [target] = selectTargets([FOUNDER_VERIFIED]);

    expect(target?.why).toContain("Founder");
    expect(target?.why).toMatch(/confirmed by a Trust Tai member/i);
  });
});

describe("buildHandoffDraft", () => {
  const candidate = {
    prospect: {
      id: "prospect-1",
      organizationId: "org-1",
      name: "Northbeam Studio",
      websiteUrl: "https://northbeam.example",
      status: "qualified",
      source: "scout_live_website",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    signals: [],
    fit: { whyItFits: "Runs a booking flow", strongestSignal: "", missingInputs: [] },
    evaluation: {
      score: 72,
      light: "green",
      scoreable: true,
      criteria: [],
      explanation: "Meets the core ICP criteria.",
      strongestSignal: "Live booking flow",
      evaluatorVersion: "trust-tai-icp-v3",
      icpVersion: null,
      evaluatedAt: new Date().toISOString(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  it("is ready when a verified decision maker exists", () => {
    const draft = buildHandoffDraft(candidate, [FOUNDER_VERIFIED]);

    expect(draft.contact?.fullName).toBe("Ada Rowe");
    expect(draft.targets[0]?.rank).toBe("primary");
    expect(draft.blockers).toHaveLength(0);
  });

  it("blocks the handoff when nobody on record can decide", () => {
    const draft = buildHandoffDraft(candidate, [MARKETING]);

    expect(draft.targets).toHaveLength(0);
    expect(draft.blockers.join(" ")).toMatch(/founder or decision maker/i);
  });

  it("blocks the handoff when no people have been found yet", () => {
    const draft = buildHandoffDraft(candidate, []);

    expect(draft.contact).toBeNull();
    expect(draft.blockers.length).toBeGreaterThan(0);
  });

  it("carries the reasoning Comms needs, not just a name", () => {
    const draft = buildHandoffDraft(candidate, [FOUNDER_VERIFIED]);

    expect(draft.intentBecause).toBeTruthy();
    expect(draft.context.length).toBeGreaterThan(0);
  });
});
