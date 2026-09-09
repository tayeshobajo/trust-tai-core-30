/**
 * Scout resolves known people before claiming nobody is known.
 *
 * The scenario that exposed the flaw, written generically: a company whose
 * founder is already known to Trust Tai (through their own roadmap intake, or
 * as an existing contact on that company's domain) must resolve that person
 * without anyone re-entering them by hand.
 */

import { describe, expect, it } from "vitest";

import { planPersonResolution } from "./person-resolution";
import type { Person } from "@/domain/people";
import type { WebsiteSubmission } from "@/domain/website";

function person(overrides: Partial<Person> & { id: string; fullName: string }): Person {
  return {
    organizationId: "org",
    seniority: "other",
    emailStatus: "unknown",
    confidence: "observed",
    sourceId: "manual",
    provenance: {
      appId: "scout",
      actor: { type: "user", id: "u" },
      observedAt: "2026-09-01T00:00:00.000Z",
      confidence: "observed",
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as Person;
}

function submission(overrides: Partial<WebsiteSubmission> = {}): WebsiteSubmission {
  return {
    id: "sub-1",
    organizationId: "org",
    submissionId: "ext-1",
    sourceApp: "website",
    sourceChannel: "roadmap",
    sourceType: "intake",
    submittedAt: "2026-08-20T10:00:00.000Z",
    receivedAt: "2026-08-20T10:00:01.000Z",
    attribution: {},
    person: { name: "Jordan Hale", email: "jordan@northgate.co", role: "Founder" },
    company: { name: "Northgate", website: "https://northgate.co" },
    verbatim: [],
    structured: {},
    signals: {},
    consent: {},
    linkState: "linked",
    linkReason: "domain match",
    ...overrides,
  } as unknown as WebsiteSubmission;
}

describe("planPersonResolution", () => {
  it("records the founder a company named in its own roadmap intake", () => {
    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [],
      submissions: [submission()],
      websiteUrl: "https://northgate.co",
    });

    expect(plan.link).toEqual([]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({
      fullName: "Jordan Hale",
      email: "jordan@northgate.co",
      roleTitle: "Founder",
      seniority: "founder",
      reason: "inbound_intake",
      submissionId: "sub-1",
    });
    expect(plan.create[0]?.note).toContain("20 August 2026");
  });

  it("reuses the canonical record when that human is already on file", () => {
    const existing = person({
      id: "contact-9",
      fullName: "Jordan Hale",
      email: "jordan@northgate.co",
      confidence: "human_confirmed",
    });

    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [existing],
      submissions: [submission()],
      websiteUrl: "https://northgate.co",
    });

    expect(plan.create).toEqual([]);
    expect(plan.link).toEqual([
      { contactId: "contact-9", reason: "inbound_intake", note: expect.any(String) },
    ]);
  });

  it("matches on an exact name when the intake gave no address", () => {
    const existing = person({ id: "c1", fullName: "jordan  hale" });
    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [existing],
      submissions: [submission({ person: { name: "Jordan Hale" } } as Partial<WebsiteSubmission>)],
      websiteUrl: "https://northgate.co",
    });
    expect(plan.link.map((l) => l.contactId)).toEqual(["c1"]);
  });

  it("says nothing when the person is already on this company", () => {
    const already = person({ id: "c1", fullName: "Jordan Hale", email: "jordan@northgate.co" });
    const plan = planPersonResolution({
      prospectPeople: [already],
      orgPeople: [already],
      submissions: [submission()],
      websiteUrl: "https://northgate.co",
    });
    expect(plan).toEqual({ link: [], create: [] });
  });

  it("resolves a person already on record with that company's business domain", () => {
    const colleague = person({ id: "c2", fullName: "Ada Poole", email: "ada@northgate.co" });
    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [colleague],
      submissions: [],
      websiteUrl: "https://www.northgate.co",
    });
    expect(plan.link).toEqual([
      { contactId: "c2", reason: "same_domain", note: expect.stringContaining("northgate.co") },
    ]);
  });

  it("leaves people who belong to another company or client alone", () => {
    const taken = person({
      id: "c3",
      fullName: "Ada Poole",
      email: "ada@northgate.co",
      prospectId: "other-prospect",
    });
    const client = person({
      id: "c4",
      fullName: "Rae Ng",
      email: "rae@northgate.co",
      clientId: "client-1",
    });
    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [taken, client],
      submissions: [],
      websiteUrl: "https://northgate.co",
    });
    expect(plan).toEqual({ link: [], create: [] });
  });

  it("never invents a person from weak similarity", () => {
    const similar = person({ id: "c5", fullName: "J. Hale", email: "j.hale@elsewhere.com" });
    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [similar],
      submissions: [submission()],
      websiteUrl: "https://northgate.co",
    });
    expect(plan.link).toEqual([]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]?.fullName).toBe("Jordan Hale");
  });

  it("never invents a person from an address alone", () => {
    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [],
      submissions: [
        submission({ person: { email: "hello@northgate.co" } } as Partial<WebsiteSubmission>),
      ],
      websiteUrl: "https://northgate.co",
    });
    expect(plan).toEqual({ link: [], create: [] });
  });

  it("stays quiet when nothing is known anywhere", () => {
    expect(
      planPersonResolution({
        prospectPeople: [],
        orgPeople: [],
        submissions: [],
        websiteUrl: "https://northgate.co",
      }),
    ).toEqual({ link: [], create: [] });
  });

  it("records one person once when the same founder submitted twice", () => {
    const plan = planPersonResolution({
      prospectPeople: [],
      orgPeople: [],
      submissions: [submission(), submission({ id: "sub-2", submissionId: "ext-2" })],
      websiteUrl: "https://northgate.co",
    });
    expect(plan.create).toHaveLength(1);
  });

  it("does not resolve by domain when the company has no website on record", () => {
    const colleague = person({ id: "c6", fullName: "Ada Poole", email: "ada@northgate.co" });
    expect(
      planPersonResolution({
        prospectPeople: [],
        orgPeople: [colleague],
        submissions: [],
        websiteUrl: null,
      }),
    ).toEqual({ link: [], create: [] });
  });
});
