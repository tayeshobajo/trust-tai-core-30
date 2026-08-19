import { describe, expect, it } from "vitest";

import { canonicalDomain, domainFromEmail, matchProspect } from "./website-matching";

describe("canonicalDomain", () => {
  it("normalises scheme, www and case", () => {
    expect(canonicalDomain("https://WWW.Elevate-Ortho.com/pricing")).toBe("elevate-ortho.com");
    expect(canonicalDomain("elevate-ortho.com")).toBe("elevate-ortho.com");
  });

  it("refuses anything that is not a host", () => {
    expect(canonicalDomain("")).toBe("");
    expect(canonicalDomain("localhost")).toBe("");
    expect(canonicalDomain("not a url")).toBe("");
  });
});

describe("domainFromEmail", () => {
  it("uses a work domain as evidence", () => {
    expect(domainFromEmail("sam@elevate-ortho.com")).toBe("elevate-ortho.com");
  });

  it("treats free mailboxes as no evidence", () => {
    expect(domainFromEmail("sam@gmail.com")).toBe("");
  });
});

describe("matchProspect", () => {
  const pool = [
    { id: "p1", name: "Elevate Orthodontics", websiteUrl: "https://www.elevate-ortho.com" },
    { id: "p2", name: "Other Co", websiteUrl: "https://other.co" },
  ];

  it("matches an existing prospect on domain", () => {
    const outcome = matchProspect({ companyWebsite: "elevate-ortho.com" }, pool);
    expect(outcome).toMatchObject({ kind: "matched", prospectId: "p1" });
  });

  it("falls back to the work email domain", () => {
    const outcome = matchProspect({ personEmail: "sam@other.co" }, pool);
    expect(outcome).toMatchObject({ kind: "matched", prospectId: "p2" });
  });

  it("creates an inbound prospect when the domain is new", () => {
    const outcome = matchProspect(
      { companyName: "New Clinic", companyWebsite: "https://newclinic.io" },
      pool,
    );
    expect(outcome).toMatchObject({
      kind: "create",
      name: "New Clinic",
      websiteUrl: "https://newclinic.io",
    });
  });

  it("holds the submission when two records share a domain", () => {
    const outcome = matchProspect({ companyWebsite: "other.co" }, [
      ...pool,
      { id: "p3", name: "Other Co duplicate", websiteUrl: "http://www.other.co" },
    ]);
    expect(outcome.kind).toBe("ambiguous");
  });

  it("never guesses from a typed company name alone", () => {
    const outcome = matchProspect(
      { companyName: "Elevate Orthodontics", personEmail: "sam@gmail.com" },
      pool,
    );
    expect(outcome.kind).toBe("ambiguous");
  });

  it("holds a submission with no identity at all", () => {
    expect(matchProspect({}, pool).kind).toBe("ambiguous");
  });
});
