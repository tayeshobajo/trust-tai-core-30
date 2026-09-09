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
  POOL_TRUNCATED_REASON,
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

/**
 * Records the filters applied, so org + source scoping can be asserted.
 *
 * `totalInPool` is what the follow-up "does this org hold ANY leads?" count
 * sees. It defaults to the row count, so an ordinary miss on an org with no
 * leads still reads as an empty pool.
 */
function stubClient(rows: unknown[], totalInPool?: number) {
  const filters: Record<string, unknown> = {};
  const tables: string[] = [];
  let readLimit: number | null = null;

  // The count probe (`select(..., { head: true })`) returns no rows, only a count.
  const countBuilder: Record<string, unknown> = {
    eq: () => countBuilder,
    then: (resolve: (r: { count: number; error: null }) => unknown) =>
      resolve({ count: totalInPool ?? rows.length, error: null }),
  };

  const builder: Record<string, unknown> = {
    select: (_columns: string, options?: { head?: boolean }) =>
      options?.head ? countBuilder : builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    ilike: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    limit: (n: number) => {
      readLimit = n;
      return builder;
    },
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };

  const from = vi.fn((table: string) => {
    tables.push(table);
    return builder;
  });
  return {
    client: { from } as never,
    filters,
    tables,
    readLimit: () => readLimit,
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

  it("reads from the prospects table", async () => {
    // Without this, a typo'd table name passes the whole suite.
    const { client, tables } = stubClient([row({})]);
    await zenModePoolFindPerson(client, MEREDITH);
    expect(tables[0]).toBe("prospects");
  });

  it("pushes the surname into the query and caps the read", async () => {
    // The ranking gate demands an exact surname token, so filtering on it
    // server-side can only drop rows that were going to be rejected anyway —
    // and it keeps the row ceiling from being what decides the answer.
    const { client, filters, readLimit } = stubClient([row({})]);
    await zenModePoolFindPerson(client, MEREDITH);
    expect(filters["metadata->zenmode->>name"]).toBe("%Lile%");
    expect(readLimit()).toBe(1000);
  });

  it("reads broadly rather than risk a filter that could exclude a real match", async () => {
    // A single-token name has no surname to anchor on; a wildcard character
    // would change LIKE semantics. Either way: no filter, not a wrong filter.
    const { client, filters } = stubClient([row({})]);
    await zenModePoolFindPerson(client, { organizationId: "org_mine", fullName: "Cher" });
    expect(filters["metadata->zenmode->>name"]).toBeUndefined();

    const wild = stubClient([row({})]);
    await zenModePoolFindPerson(wild.client, {
      organizationId: "org_mine",
      fullName: "Robert %Drop",
    });
    expect(wild.filters["metadata->zenmode->>name"]).toBeUndefined();
  });

  it("refuses to call a truncated search a definitive no", async () => {
    // 1000 rows means we hit the ceiling, so the person may simply be on the
    // page we never read. Saying "no match" there would be a lie.
    const many = Array.from({ length: 1000 }, (_, i) =>
      row({ name: `Person ${i}`, linkedin: `https://www.linkedin.com/in/p${i}` }),
    );
    const { client } = stubClient(many);
    const result = await zenModePoolFindPerson(client, MEREDITH);
    expect(result.truncated).toBe(true);
    expect(result.noMatchReason).toBe(POOL_TRUNCATED_REASON);
  });

  it("still says 'run a campaign' when a filtered search finds an org with no leads", async () => {
    // The surname filter makes zero rows ambiguous; a count settles it, so the
    // empty-pool answer survives the optimisation that could have hidden it.
    const { client } = stubClient([], 0);
    const result = await zenModePoolFindPerson(client, MEREDITH);
    expect(result.noMatchReason).toBe(EMPTY_POOL_REASON);
  });

  it("calls a filtered miss a miss when the org does hold other leads", async () => {
    const { client } = stubClient([], 42);
    const result = await zenModePoolFindPerson(client, MEREDITH);
    expect(result.noMatchReason).toBe(NO_POOL_MATCH_REASON);
  });

  it("surfaces a read failure instead of reporting an empty pool", async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      ilike: () => builder,
      limit: () => builder,
      then: (resolve: (r: { data: null; error: { message: string } }) => unknown) =>
        resolve({ data: null, error: { message: "permission denied" } }),
    };
    const client = { from: () => builder } as never;
    await expect(zenModePoolFindPerson(client, MEREDITH)).rejects.toThrow(/permission denied/);
  });
});
