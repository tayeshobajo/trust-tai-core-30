/**
 * Auth gate for the public contact-route search.
 *
 * This route bypasses site auth, so the handler is the entire security
 * boundary: bearer token → getUser → server-side membership read → the search
 * runs with the CALLER'S token so RLS applies. These tests pin that order and,
 * critically, that a client-supplied organization_id only ever selects among
 * the caller's OWN memberships — it is never trusted as an identity claim.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { trustTaiSupabaseKey } from "@/lib/trust-tai-backend.server";

const createClientCalls: { key: string; headers: Record<string, string> }[] = [];
let stub: ReturnType<typeof makeStub>;

vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    _url: string,
    key: string,
    options: { global: { headers: Record<string, string> } },
  ) => {
    createClientCalls.push({ key, headers: options.global.headers });
    return stub.client;
  },
}));

const poolFindPerson = vi.fn();
vi.mock("@/lib/zenmode-pool-lookup.server", () => ({
  zenModePoolFindPerson: (...args: unknown[]) => poolFindPerson(...args),
}));

import { Route } from "./zenmode.lookup";

/**
 * A supabase client stub in the established thenable-builder shape: it records
 * the `.eq()` filters applied to the membership read so scoping can be
 * asserted, and lets each test choose the getUser and membership answers.
 */
function makeStub(over?: {
  user?: { id: string } | null;
  userError?: { message: string } | null;
  memberships?: { organization_id: string; status?: string }[] | null;
  membershipError?: { message: string } | null;
}) {
  const filters: Record<string, unknown> = {};
  const tables: string[] = [];
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    then: (resolve: (r: { data: unknown; error: unknown }) => unknown) =>
      resolve({
        data: over?.membershipError ? null : (over?.memberships ?? []),
        error: over?.membershipError ?? null,
      }),
  };
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: over?.user === undefined ? { id: "user_1" } : over.user },
        error: over?.userError ?? null,
      })),
    },
    from: (table: string) => {
      tables.push(table);
      return builder;
    },
  };
  return { client, filters, tables };
}

function post(body: unknown, token?: string): Request {
  return new Request("https://app.test/api/public/zenmode/lookup", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

// The handlers option is a union with a functional form; narrow it for tests.
const handler = (Route.options.server!.handlers as { POST: unknown }).POST as (ctx: {
  request: Request;
}) => Promise<Response>;

const SEARCH = { full_name: "Meredith Lile" };

beforeEach(() => {
  createClientCalls.length = 0;
  poolFindPerson.mockReset();
  poolFindPerson.mockResolvedValue({ candidates: [], noMatchReason: null, poolSize: 0 });
  stub = makeStub();
});

describe("POST /api/public/zenmode/lookup auth gate", () => {
  it("rejects a request with no Authorization header, before touching Supabase", async () => {
    const res = await handler({ request: post(SEARCH) });
    expect(res.status).toBe(401);
    expect(createClientCalls).toHaveLength(0);
  });

  it("rejects a malformed Authorization header (not a Bearer scheme)", async () => {
    const request = new Request("https://app.test/api/public/zenmode/lookup", {
      method: "POST",
      headers: { Authorization: "Basic abc123" },
      body: JSON.stringify(SEARCH),
    });
    const res = await handler({ request });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid or expired session (getUser returns no user)", async () => {
    stub = makeStub({ user: null, userError: { message: "invalid JWT" } });
    const res = await handler({ request: post(SEARCH, "expired-token") });
    expect(res.status).toBe(401);
    expect(poolFindPerson).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user with no active membership", async () => {
    stub = makeStub({ memberships: [{ organization_id: "org_a", status: "revoked" }] });
    const res = await handler({ request: post(SEARCH, "good-token") });
    expect(res.status).toBe(403);
    expect(poolFindPerson).not.toHaveBeenCalled();
  });

  it("resolves membership server-side, filtered by the authenticated user's id", async () => {
    stub = makeStub({ memberships: [{ organization_id: "org_a" }] });
    await handler({ request: post(SEARCH, "good-token") });
    expect(stub.tables).toContain("organization_memberships");
    expect(stub.filters["user_id"]).toBe("user_1");
  });

  it("refuses an org-B organization_id from an org-A member, returning no org-B data", async () => {
    stub = makeStub({ memberships: [{ organization_id: "org_a", status: "active" }] });
    const res = await handler({
      request: post({ ...SEARCH, organization_id: "org_b" }, "good-token"),
    });
    expect(res.status).toBe(403);
    // The forbidden org must not leak through the search path at all.
    expect(poolFindPerson).not.toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("org_b");
  });

  it("searches the caller's own org when its organization_id IS one of their memberships", async () => {
    stub = makeStub({
      memberships: [{ organization_id: "org_a" }, { organization_id: "org_c" }],
    });
    const res = await handler({
      request: post({ ...SEARCH, organization_id: "org_c" }, "good-token"),
    });
    expect(res.status).toBe(200);
    expect(poolFindPerson).toHaveBeenCalledWith(
      stub.client,
      expect.objectContaining({ organizationId: "org_c" }),
    );
  });

  it("surfaces a failed membership read as 5xx, never as 'not a member'", async () => {
    stub = makeStub({ membershipError: { message: "permission denied" } });
    const res = await handler({ request: post(SEARCH, "good-token") });
    expect(res.status).toBe(503);
    expect(poolFindPerson).not.toHaveBeenCalled();
  });

  it("uses the publishable key and the caller's own token — never a service-role key", async () => {
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-secret";
    try {
      stub = makeStub({ memberships: [{ organization_id: "org_a" }] });
      await handler({ request: post(SEARCH, "callers-token") });
      expect(createClientCalls).toHaveLength(1);
      const call = createClientCalls[0]!;
      expect(call.key).toBe(trustTaiSupabaseKey());
      expect(call.key).not.toContain("service");
      expect(call.headers["Authorization"]).toBe("Bearer callers-token");
    } finally {
      delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    }
  });
});
