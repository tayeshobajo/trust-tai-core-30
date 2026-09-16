import { describe, expect, it } from "vitest";

import {
  canAutoMatch,
  identityKey,
  savableResearch,
  storedEmailFacts,
} from "./scout-people-persistence";

describe("identityKey", () => {
  it("prefers the provider identity", () => {
    expect(
      identityKey({
        key: "apollo:abc",
        fullName: "Keith",
        providerPersonId: "abc",
        workEmail: "k@acme.com",
      }),
    ).toEqual({ kind: "provider", value: "abc" });
  });

  it("falls back to an address, then a profile", () => {
    expect(identityKey({ key: "k", fullName: "Keith", workEmail: "K@Acme.com " })).toEqual({
      kind: "email",
      value: "k@acme.com",
    });
    expect(
      identityKey({ key: "k", fullName: "Keith", profileUrl: "https://x.com/keith/" }),
    ).toEqual({ kind: "profile", value: "https://x.com/keith" });
  });

  it("never matches two people on a name alone", () => {
    const a = identityKey({ key: "row-1", fullName: "Sam Reed" });
    const b = identityKey({ key: "row-2", fullName: "Sam Reed" });
    expect(a.kind).toBe("manual");
    expect(canAutoMatch(a, b)).toBe(false);
  });
});

describe("storedEmailFacts", () => {
  it("records verified only when the provider said so", () => {
    expect(
      storedEmailFacts({ email: "k@acme.com", verified: true, provider: "apollo", at: "2026-09-16T00:00:00Z" }),
    ).toEqual({
      workEmail: "k@acme.com",
      emailStatus: "verified",
      emailFetchedAt: "2026-09-16T00:00:00Z",
      emailVerifiedAt: "2026-09-16T00:00:00Z",
      provider: "apollo",
    });
  });

  it("records found, not verified without a verification time", () => {
    const facts = storedEmailFacts({
      email: "k@acme.com",
      verified: false,
      provider: "apollo",
      at: "2026-09-16T00:00:00Z",
    });
    expect(facts.emailStatus).toBe("found_unverified");
    expect(facts.emailVerifiedAt).toBeNull();
  });

  it("records not found without an address", () => {
    const facts = storedEmailFacts({
      email: null,
      verified: true,
      provider: "apollo",
      at: "2026-09-16T00:00:00Z",
    });
    expect(facts.workEmail).toBeNull();
    expect(facts.emailStatus).toBe("not_found");
    expect(facts.emailVerifiedAt).toBeNull();
  });
});

describe("savableResearch", () => {
  it("drops a forged address and verification a browser sent", () => {
    const saved = savableResearch({
      fullName: "Keith",
      companyName: "Acumen",
      whyThisPerson: "Leads the function",
      provider: "apollo",
      workEmail: "forged@acme.com",
      emailStatus: "verified",
      emailVerifiedAt: "2026-09-16T00:00:00Z",
      discoveredAt: "2026-09-16T00:00:00Z",
      buyingRole: "owner",
      support: 10,
      key: "k",
    });
    expect(saved).not.toBeNull();
    expect(JSON.stringify(saved)).not.toContain("forged@acme.com");
    expect(JSON.stringify(saved)).not.toContain("verified");
  });

  it("refuses a person with no name or no company", () => {
    expect(savableResearch({ fullName: " ", companyName: "Acumen" })).toBeNull();
    expect(savableResearch({ fullName: "Keith", companyName: "" })).toBeNull();
  });
});
