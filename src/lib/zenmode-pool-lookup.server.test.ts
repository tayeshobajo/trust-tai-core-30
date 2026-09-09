/**
 * Contact-route search over the ZenMode lead pool.
 *
 * The behaviour that matters here is what happens when the answer is "no".
 * Linki's failure mode was a live LinkedIn block; this path's failure mode is
 * an honest miss, and the two "no" answers must stay distinguishable — an empty
 * pool tells a person to run a campaign, a non-match tells them to try the
 * company website. Collapsing them is what makes a search box untrustworthy.
 */

import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_POOL_REASON,
  NO_POOL_MATCH_REASON,
  zenModePoolFindPerson,
} from "@/lib/zenmode-pool-lookup.server";

/** A stored ZenMode prospect row, in the shape the import actually writes. */
function row(over: {
  company?: string | null;
  name?: unknown;
  title?: string | null;
  location?: string | null;
  linkedin?: unknown;
}) {
  return {
    company_name: over.company === undefined ? "Pure Sweat + Float Studio" : over.company,
    metadata: {
      zenmode: {
        name: over.name === undefined ? "Meredith Lile" : over.name,
        title: over.title === undefined ? "Owner of Pure Sweat + Float Studio" : over.title,
        location: over.location === undefined ? "Nashville Metropolitan Area" : over.location,
        linkedin_url:
          over.linkedin === undefined ? "https://www.linkedin.com/in/meredith" : over.linkedin,
        company_reported_by_zenmode: "Brentwood",
      },
    },
  };
}

/** Records the filters applied, so org + source scoping can be asserted. */
function stubClient(rows: unknown[]) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  return {
    client: { from: vi.fn(() => builder) } as never,
    filters,
  };
}

const MEREDITH = {
  organizationId: "org_mine",
  fullName: "Meredith Lile",
  companyName: "Pure Sweat + Float Studio",
  roleTitle: "Owner",
};

describe("zenModePoolFindPerson", () => {
  it("finds a person the campaign already scraped, with their route", async () => {
    const { client } = stubClient([row({})]);
    const result = await zenModePoolFindPerson(client, MEREDITH);
    expect(result.noMatchReason).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.linkedinUrl).toBe("https://www.linkedin.com/in/meredith");
    expect(result.poolSize).toBe(1);
  });

  it("scopes the read to the caller's organization and to ZenMode leads only", async () => {
    const { client, filters } = stubClient([row({})]);
    await zenModePoolFindPerson(client, MEREDITH);
    expect(filters["organization_id"]).toBe("org_mine");
    expect(filters["source"]).toBe("zenmode");
  });

  it("says the pool is empty, rather than reporting a failed match", async () => {
    const { client } = stubClient([]);
    const result = await zenModePoolFindPerson(client, MEREDITH);
    expect(result.noMatchReason).toBe(EMPTY_POOL_REASON);
    expect(result.poolSize).toBe(0);
  });

  it("distinguishes a real miss from an empty pool", async () => {
    const { client } = stubClient([row({})]);
    const result = await zenModePoolFindPerson(client, {
      organizationId: "org_mine",
      fullName: "Robin Shah",
      companyName: "Somewhere Else",
    });
    expect(result.noMatchReason).toBe(NO_POOL_MATCH_REASON);
    // The pool was real and was searched — that is the whole distinction.
    expect(result.poolSize).toBe(1);
  });

  it("ignores leads with no name or no route instead of offering half an identity", async () => {
    const { client } = stubClient([row({ name: null }), row({ linkedin: null }), row({})]);
    const result = await zenModePoolFindPerson(client, MEREDITH);
    expect(result.poolSize).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("prefers the prospect's resolved company over ZenMode's headline fragment", async () => {
    const { client } = stubClient([row({})]);
    const result = await zenModePoolFindPerson(client, MEREDITH);
    // "Brentwood" is ZenMode's guess; the import already resolved the real name.
    expect(result.candidates[0]?.company).toBe("Pure Sweat + Float Studio");
  });

  it("surfaces a read failure instead of reporting an empty pool", async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      then: (resolve: (r: { data: null; error: { message: string } }) => unknown) =>
        resolve({ data: null, error: { message: "permission denied" } }),
    };
    const client = { from: () => builder } as never;
    await expect(zenModePoolFindPerson(client, MEREDITH)).rejects.toThrow(/permission denied/);
  });
});
