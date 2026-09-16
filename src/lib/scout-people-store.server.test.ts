/**
 * The durable home for Scout's researched people.
 *
 * What is proved here: a reference from another workspace is refused, a
 * missing table is reported as a gap rather than a failure, a browser cannot
 * produce a verified address, two saves of the same person settle in one row,
 * a failed write says so instead of pretending, and handing the same person
 * over twice returns the first conversation.
 */

import { describe, expect, it } from "vitest";

import {
  ScoutPeopleSchemaUnavailable,
  ScoutPeopleStoreError,
  scoutPeopleStore,
} from "@/lib/scout-people-store.server";
import type { SavableResearch } from "@/domain/scout-people-persistence";

type Row = Record<string, unknown>;

interface Plan {
  prospect?: Row | null;
  prospectError?: { code?: string; message?: string } | null;
  upsert?: { data?: Row[] | null; error?: { code?: string; message?: string } | null };
  update?: { data?: Row | null; error?: { code?: string; message?: string } | null };
  select?: { data?: Row[] | null; error?: { code?: string; message?: string } | null };
  single?: Row | null;
}

/** A Supabase-shaped double that records what was asked of it. */
function fakeDb(plan: Plan) {
  const calls: { table: string; op: string; payload?: unknown; filters: Row }[] = [];

  function builder(table: string, op: string, payload?: unknown) {
    const filters: Row = {};
    const call = { table, op, payload, filters };
    calls.push(call);

    const result = () => {
      if (table === "prospects") {
        return { data: plan.prospect ?? null, error: plan.prospectError ?? null };
      }
      if (op === "upsert") {
        return { data: plan.upsert?.data ?? null, error: plan.upsert?.error ?? null };
      }
      if (op === "update") {
        return { data: plan.update?.data ?? null, error: plan.update?.error ?? null };
      }
      if (op === "selectOne") {
        return { data: plan.single ?? null, error: null };
      }
      return { data: plan.select?.data ?? null, error: plan.select?.error ?? null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      order: () => chain,
      maybeSingle: () => {
        if (table === "prospects") {
          return Promise.resolve({ data: plan.prospect ?? null, error: plan.prospectError ?? null });
        }
        if (op === "select") call.op = "selectOne";
        return Promise.resolve(
          op === "select" ? { data: plan.single ?? null, error: plan.select?.error ?? null } : result(),
        );
      },
      then: (resolve: (value: unknown) => unknown) => resolve(result()),
    };
    return chain;
  }

  const db = {
    from: (table: string) => ({
      select: () => builder(table, "select"),
      insert: (payload: unknown) => builder(table, "insert", payload),
      upsert: (payload: unknown) => builder(table, "upsert", payload),
      update: (payload: unknown) => builder(table, "update", payload),
    }),
  };
  return { db: db as never, calls };
}

const person: SavableResearch = {
  fullName: "Keith",
  companyName: "Acumen Technology",
  buyingRole: "owner",
  whyThisPerson: "Leads the function this work sits in.",
  provider: "apollo",
  providerPersonId: "5b284b74",
  discoveredAt: "2026-09-16T00:00:00.000Z",
};

const savedRow: Row = {
  id: "row-1",
  organization_id: "org-1",
  prospect_id: "pro-1",
  full_name: "Keith",
  company_name: "Acumen Technology",
  why_this_person: "Leads the function this work sits in.",
  buying_role: "owner",
  provider: "apollo",
  provider_person_id: "5b284b74",
  match_kind: "provider",
  match_value: "5b284b74",
  email_status: "not_checked",
  discovered_at: "2026-09-16T00:00:00.000Z",
  created_by: "user-1",
};

describe("saveResearch", () => {
  it("refuses a company from another workspace", async () => {
    const { db } = fakeDb({ prospect: null });
    const store = scoutPeopleStore({ db });
    await expect(
      store.saveResearch({
        organizationId: "org-1",
        prospectId: "other-workspace",
        createdBy: "user-1",
        people: [person],
      }),
    ).rejects.toBeInstanceOf(ScoutPeopleStoreError);
  });

  it("reports a missing table as a gap, not a failure", async () => {
    const { db } = fakeDb({
      prospect: { id: "pro-1" },
      upsert: { error: { code: "42P01", message: 'relation "scout_people" does not exist' } },
    });
    await expect(
      scoutPeopleStore({ db }).saveResearch({
        organizationId: "org-1",
        prospectId: "pro-1",
        createdBy: "user-1",
        people: [person],
      }),
    ).rejects.toBeInstanceOf(ScoutPeopleSchemaUnavailable);
  });

  it("stamps the verified actor and never an address", async () => {
    const { db, calls } = fakeDb({ prospect: { id: "pro-1" }, upsert: { data: [savedRow] } });
    const saved = await scoutPeopleStore({ db }).saveResearch({
      organizationId: "org-1",
      prospectId: "pro-1",
      createdBy: "user-1",
      people: [person],
    });
    const upsert = calls.find((call) => call.op === "upsert");
    const payload = (upsert?.payload as Row[])[0] as Row;
    expect(payload["created_by"]).toBe("user-1");
    expect(payload["match_kind"]).toBe("provider");
    expect(Object.keys(payload)).not.toContain("work_email");
    expect(Object.keys(payload)).not.toContain("email_status");
    expect(saved[0]?.emailStatus).toBe("not_checked");
  });

  it("lets two concurrent saves settle in the database, not in the app", async () => {
    const { db } = fakeDb({
      prospect: { id: "pro-1" },
      upsert: { error: { code: "23505", message: "duplicate key" } },
      select: { data: [savedRow] },
    });
    const saved = await scoutPeopleStore({ db }).saveResearch({
      organizationId: "org-1",
      prospectId: "pro-1",
      createdBy: "user-1",
      people: [person],
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.id).toBe("row-1");
  });

  it("says a write failed rather than reporting a save", async () => {
    const { db } = fakeDb({
      prospect: { id: "pro-1" },
      upsert: { error: { code: "08006", message: "connection lost" } },
    });
    await expect(
      scoutPeopleStore({ db }).saveResearch({
        organizationId: "org-1",
        prospectId: "pro-1",
        createdBy: "user-1",
        people: [person],
      }),
    ).rejects.toBeInstanceOf(ScoutPeopleStoreError);
  });
});

describe("recordEmail", () => {
  it("writes verified only from the provider answer", async () => {
    const { db, calls } = fakeDb({
      update: { data: { ...savedRow, work_email: "k@acumen.com", email_status: "verified" } },
    });
    await scoutPeopleStore({ db }).recordEmail({
      organizationId: "org-1",
      prospectId: "pro-1",
      personId: "row-1",
      answer: { email: "k@acumen.com", verified: true, provider: "apollo", at: "2026-09-16T17:28:00.000Z" },
    });
    const update = calls.find((call) => call.op === "update");
    expect(update?.payload).toMatchObject({
      work_email: "k@acumen.com",
      email_status: "verified",
      email_verified_at: "2026-09-16T17:28:00.000Z",
    });
  });

  it("never records verified when the provider did not verify", async () => {
    const { db, calls } = fakeDb({ update: { data: savedRow } });
    await scoutPeopleStore({ db }).recordEmail({
      organizationId: "org-1",
      prospectId: "pro-1",
      personId: "row-1",
      answer: { email: "k@acumen.com", verified: false, provider: "apollo", at: "2026-09-16T17:28:00.000Z" },
    });
    const update = calls.find((call) => call.op === "update");
    expect(update?.payload).toMatchObject({
      email_status: "found_unverified",
      email_verified_at: null,
    });
  });
});

describe("recordHandoff", () => {
  it("returns the first conversation when the same person is handed over twice", async () => {
    const { db, calls } = fakeDb({
      single: { ...savedRow, handoff_relationship_id: "rel-1" },
    });
    const result = await scoutPeopleStore({ db }).recordHandoff({
      organizationId: "org-1",
      personId: "row-1",
      relationshipId: "rel-2",
    });
    expect(result.handoffRelationshipId).toBe("rel-1");
    expect(calls.some((call) => call.op === "update")).toBe(false);
  });
});

describe("list", () => {
  it("reads saved people without touching any provider", async () => {
    const { db, calls } = fakeDb({ select: { data: [savedRow] } });
    const people = await scoutPeopleStore({ db }).list({
      organizationId: "org-1",
      prospectId: "pro-1",
    });
    expect(people[0]?.fullName).toBe("Keith");
    expect(calls.every((call) => call.table === "scout_people")).toBe(true);
  });
});
