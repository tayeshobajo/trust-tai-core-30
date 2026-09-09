/**
 * ZenMode → Scout import: business-name resolution.
 *
 * The regression pinned here came from real campaign 2347 data: ZenMode derives
 * `company` by splitting the LinkedIn headline, so 44 of 114 leads arrived with
 * a fragment — `"Inc."`, `"LLC"`, `"COVID"`, `"Brentwood"` — which would have
 * become the prospect's display name on the Scout board.
 */

import { describe, expect, it } from "vitest";

import { companyFromHeadline, resolveCompanyName } from "@/lib/zenmode-scout-import.server";
import type { ZenModeLead } from "@/lib/zenmode-provider.server";

function lead(partial: Partial<ZenModeLead>): ZenModeLead {
  return {
    leadId: "1",
    campaignId: "2347",
    name: null,
    linkedinUrl: "https://www.linkedin.com/in/example",
    companyName: null,
    websiteUrl: null,
    title: null,
    location: null,
    status: "pending",
    raw: {},
    ...partial,
  };
}

describe("companyFromHeadline", () => {
  it("reads the business out of the connectors owners actually write", () => {
    expect(companyFromHeadline("Owner, Happle Printing Partnership")).toBe(
      "Happle Printing Partnership",
    );
    expect(companyFromHeadline("Business Owner at Complete Lawn & Yard Care, Inc.")).toBe(
      "Complete Lawn & Yard Care, Inc",
    );
    expect(companyFromHeadline("Owner of Summit Structures")).toBe("Summit Structures");
    expect(companyFromHeadline("CEO at Pride Rock Oil and Gas, LLC")).toBe(
      "Pride Rock Oil and Gas, LLC",
    );
    expect(companyFromHeadline("Co-founder & CEO @ Outsmart")).toBe("Outsmart");
  });

  it("lets 'at' beat an 'of' that belongs to the role itself", () => {
    expect(companyFromHeadline("Owner & Director of Funding at Top Funding")).toBe("Top Funding");
  });

  it("takes the last 'at', so a business with 'of' in its name survives", () => {
    expect(companyFromHeadline("Owner at Bank of America")).toBe("Bank of America");
  });

  it("reads a connector-less headline, but not a bare second role word", () => {
    expect(companyFromHeadline("Owner Shane McFarland Construction")).toBe(
      "Shane McFarland Construction",
    );
    expect(companyFromHeadline("Owner Operator")).toBeNull();
  });

  it("keeps the business and drops the marketing blurb after a pipe", () => {
    expect(
      companyFromHeadline(
        "President/Owner @ IKON Construction, Inc. | Commercial Construction, Project Management",
      ),
    ).toBe("IKON Construction, Inc");
  });

  it("stops at a dangling editorial suffix rather than swallowing it", () => {
    expect(
      companyFromHeadline("Owner at Thee Hubbell House B&B Resort --CLOSED. Victim of COVID-19"),
    ).toBe("Thee Hubbell House B&B Resort");
  });

  it("returns null when the headline names only a role", () => {
    expect(companyFromHeadline("CEO / Owner")).toBeNull();
    expect(companyFromHeadline("Chief Executive Officer")).toBeNull();
    expect(companyFromHeadline("Owner/Lead Interior Designer")).toBeNull();
    expect(companyFromHeadline("")).toBeNull();
    expect(companyFromHeadline(null)).toBeNull();
  });
});

describe("resolveCompanyName", () => {
  it("prefers the headline over ZenMode's fragment", () => {
    expect(
      resolveCompanyName(
        lead({
          title: "Business Owner at Complete Lawn & Yard Care, Inc.",
          companyName: "Inc.",
          name: "James Sneck",
        }),
      ),
    ).toBe("Complete Lawn & Yard Care, Inc");
    expect(
      resolveCompanyName(
        lead({
          title: "Owner of Pure Sweat + Float Studio, Brentwood",
          companyName: "Brentwood",
          name: "Meredith Lile",
        }),
      ),
    ).toBe("Pure Sweat + Float Studio, Brentwood");
  });

  it("never lets bare legal residue become the display name", () => {
    for (const residue of ["Inc.", "LLC", "PLLC", "COVID", "Co."]) {
      expect(
        resolveCompanyName(lead({ title: "Chief Executive Officer", companyName: residue, name: "Jane Doe" })),
      ).toBe("Jane Doe");
    }
  });

  it("falls back to ZenMode's field when it is a real name and the headline gives nothing", () => {
    expect(
      resolveCompanyName(lead({ title: "Chief Executive Officer", companyName: "Anquiro", name: "A B" })),
    ).toBe("Anquiro");
  });

  it("falls back to the person, then to a marker, rather than inventing a company", () => {
    expect(resolveCompanyName(lead({ title: "CEO / Owner", name: "M M." }))).toBe("M M.");
    expect(resolveCompanyName(lead({ title: null, name: null }))).toBe("ZenMode lead");
  });
});
