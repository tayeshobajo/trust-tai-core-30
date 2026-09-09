/**
 * ZenMode → Scout import: business-name resolution.
 *
 * The regression pinned here came from real campaign 2347 data: ZenMode derives
 * `company` by splitting the LinkedIn headline, so 44 of 114 leads arrived with
 * a fragment — `"Inc."`, `"LLC"`, `"COVID"`, `"Brentwood"` — which would have
 * become the prospect's display name on the Scout board.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  companyFromHeadline,
  resolveCompanyName,
  runZenModeImportForCaller,
} from "@/lib/zenmode-scout-import.server";
import type { ZenModeLead } from "@/lib/zenmode-provider.server";

vi.mock("@/lib/trust-tai-backend.server", () => ({
  trustTaiSupabaseUrl: () => "https://project.supabase.co",
  trustTaiSupabaseKey: () => "anon_key",
}));

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

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

describe("runZenModeImportForCaller", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    createClient.mockReset();
  });

  const ENV = {
    ZENMODE_READ_ENABLED: "true",
    ZENMODE_API_KEY: "zm_test_key",
    ZENMODE_SCOUT_IMPORT_ENABLED: "true",
  };

  /** A Supabase double: a user (or none), memberships, an empty board, and a
   * recorder for every row the import tries to insert. */
  function stubSupabase(options: {
    user?: { id: string } | null;
    memberships?: Record<string, unknown>[];
  }) {
    const inserted: Record<string, unknown>[] = [];
    const client = {
      auth: {
        getUser: async () =>
          options.user
            ? { data: { user: options.user }, error: null }
            : { data: { user: null }, error: { message: "bad token" } },
      },
      from(table: string) {
        if (table === "organization_memberships") {
          return { select: () => ({ eq: async () => ({ data: options.memberships ?? [] }) }) };
        }
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          },
        };
      },
    };
    createClient.mockReturnValue(client);
    return { inserted };
  }

  /** One ZenMode lead over the wire, through the real `{leads, pagination}`
   * envelope, so the provider's paging path is exercised too. */
  function stubOneLead() {
    vi.stubGlobal("fetch", async () => {
      const leads = [
        {
          id: 69551,
          name: "Meredith Lile",
          title: "Owner of Pure Sweat + Float Studio, Brentwood",
          company: "Brentwood",
          location: "Nashville Metropolitan Area",
          linkedin_url: "https://www.linkedin.com/in/meredith",
          status: "pending",
        },
      ];
      return new Response(
        JSON.stringify({ leads, pagination: { limit: 100, offset: 0, returned: 1 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
  }

  it("refuses an invalid token without touching ZenMode", async () => {
    stubSupabase({ user: null });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await runZenModeImportForCaller({ token: "bad" }, ENV)).toEqual({
      ok: false,
      refusal: "unauthenticated",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a caller with no active membership", async () => {
    stubSupabase({
      user: { id: "user_1" },
      memberships: [{ organization_id: "org_1", status: "invited" }],
    });
    expect(await runZenModeImportForCaller({ token: "t" }, ENV)).toEqual({
      ok: false,
      refusal: "no_membership",
    });
  });

  it("refuses an organization the caller does not belong to", async () => {
    stubSupabase({
      user: { id: "user_1" },
      memberships: [{ organization_id: "org_mine", status: "active" }],
    });
    expect(
      await runZenModeImportForCaller({ token: "t", organizationId: "org_theirs" }, ENV),
    ).toEqual({ ok: false, refusal: "no_membership" });
  });

  it("imports into the caller's own organization and stamps them as author", async () => {
    const { inserted } = stubSupabase({
      user: { id: "user_1" },
      memberships: [{ organization_id: "org_mine", status: "active" }],
    });
    stubOneLead();

    const outcome = await runZenModeImportForCaller({ token: "t" }, ENV);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.organizationId).toBe("org_mine");
    expect(outcome.result.imported).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organization_id: "org_mine",
      created_by: "user_1",
      source: "zenmode",
      status: "discovered",
      // The headline beats ZenMode's "Brentwood" fragment.
      company_name: "Pure Sweat + Float Studio, Brentwood",
    });
  });

  it("stays inert when the import gate is closed, writing nothing", async () => {
    const { inserted } = stubSupabase({
      user: { id: "user_1" },
      memberships: [{ organization_id: "org_mine", status: "active" }],
    });
    stubOneLead();

    const outcome = await runZenModeImportForCaller(
      { token: "t" },
      { ...ENV, ZENMODE_SCOUT_IMPORT_ENABLED: "false" },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("disabled");
    expect(inserted).toHaveLength(0);
  });
});

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
        resolveCompanyName(
          lead({ title: "Chief Executive Officer", companyName: residue, name: "Jane Doe" }),
        ),
      ).toBe("Jane Doe");
    }
  });

  it("falls back to ZenMode's field when it is a real name and the headline gives nothing", () => {
    expect(
      resolveCompanyName(
        lead({ title: "Chief Executive Officer", companyName: "Anquiro", name: "A B" }),
      ),
    ).toBe("Anquiro");
  });

  it("falls back to the person, then to a marker, rather than inventing a company", () => {
    expect(resolveCompanyName(lead({ title: "CEO / Owner", name: "M M." }))).toBe("M M.");
    expect(resolveCompanyName(lead({ title: null, name: null }))).toBe("ZenMode lead");
  });
});
