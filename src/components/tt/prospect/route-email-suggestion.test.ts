import { describe, expect, it } from "vitest";

import { suggestRouteEmail } from "./route-email-suggestion";

describe("suggestRouteEmail", () => {
  it("proposes an address when verified colleagues corroborate a convention", () => {
    const result = suggestRouteEmail({
      fullName: "Ada Lovelace",
      companyDomain: "acme.com",
      knownAddresses: [
        { fullName: "Grace Hopper", email: "grace.hopper@acme.com" },
        { fullName: "Alan Turing", email: "alan.turing@acme.com" },
      ],
    });
    expect(result.kind).toBe("suggestion");
    if (result.kind !== "suggestion") return;
    expect(result.candidate.email).toBe("ada.lovelace@acme.com");
    expect(result.candidate.rationale).toContain("Guess only");
    // The rationale itself says nobody confirmed it; the form's confirmed
    // checkbox is a separate piece of state this helper never touches.
    expect(result.candidate.rationale).toContain("Nobody has confirmed this address");
  });

  it("proposes nothing when there are no known addresses", () => {
    const result = suggestRouteEmail({
      fullName: "Ada Lovelace",
      companyDomain: "acme.com",
      knownAddresses: [],
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("proposes nothing without a company domain", () => {
    const result = suggestRouteEmail({
      fullName: "Ada Lovelace",
      companyDomain: undefined,
      knownAddresses: [{ fullName: "Grace Hopper", email: "grace.hopper@acme.com" }],
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("reports a conflict instead of picking a winner when conventions disagree", () => {
    const result = suggestRouteEmail({
      fullName: "Ada Lovelace",
      companyDomain: "acme.com",
      knownAddresses: [
        { fullName: "Grace Hopper", email: "grace.hopper@acme.com" },
        { fullName: "Alan Turing", email: "aturing@acme.com" },
      ],
    });
    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;
    expect(result.because).toContain("acme.com");
  });

  it("proposes nothing when the module declines (target has no surname for the convention)", () => {
    const result = suggestRouteEmail({
      fullName: "Cher",
      companyDomain: "acme.com",
      knownAddresses: [
        { fullName: "Grace Hopper", email: "grace.hopper@acme.com" },
        { fullName: "Alan Turing", email: "alan.turing@acme.com" },
      ],
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("ignores addresses at other domains rather than counting them as evidence", () => {
    const result = suggestRouteEmail({
      fullName: "Ada Lovelace",
      companyDomain: "acme.com",
      knownAddresses: [{ fullName: "Grace Hopper", email: "grace.hopper@othercorp.com" }],
    });
    expect(result).toEqual({ kind: "none" });
  });
});
