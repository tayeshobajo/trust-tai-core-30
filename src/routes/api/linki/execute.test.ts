/**
 * Auth gate for the governed LinkedIn execution endpoint.
 *
 * Same boundary shape as the public zenmode lookup: bearer token → getUser →
 * server-side membership read with the caller's own token. On top of that the
 * action's organization is resolved from the database, and the caller must be
 * a member of THAT organization — a caller from org A can never execute (or
 * even confirm the existence of details of) an org-B action.
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

const executeAction = vi.fn();
vi.mock("@/data/supabase/linki-actions-service", () => ({
  createLinkiActionService: () => ({ execute: executeAction }),
}));
vi.mock("@/data/supabase/activities", () => ({ supabaseActivity: {} }));
vi.mock("@/lib/linki-execution.server", () => ({ linkiSendAction: vi.fn() }));

import { Route } from "./execute";

/**
 * Thenable builders per table, recording `.eq()` filters so both the
 * membership scoping and the action lookup can be asserted.
 */
function makeStub(over?: {
  user?: { id: string } | null;
  userError?: { message: string } | null;
  memberships?: { organization_id: string; status?: string }[] | null;
  membershipError?: { message: string } | null;
  action?: { id: string; organization_id: string } | null;
  actionError?: { message: string } | null;
}) {
  const filters: Record<string, Record<string, unknown>> = {};
  const tables: string[] = [];

  function builderFor(table: string) {
    filters[table] ??= {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[table]![column] = value;
        return builder;
      },
      maybeSingle: async () => ({
        data: over?.action === undefined ? null : over.action,
        error: over?.actionError ?? null,
      }),
      then: (resolve: (r: { data: unknown; error: unknown }) => unknown) =>
        resolve({
          data: over?.membershipError ? null : (over?.memberships ?? []),
          error: over?.membershipError ?? null,
        }),
    };
    return builder;
  }

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: over?.user === undefined ? { id: "user_1" } : over.user },
        error: over?.userError ?? null,
      })),
    },
    from: (table: string) => {
      tables.push(table);
      return builderFor(table);
    },
  };
  return { client, filters, tables };
}

function post(body: unknown, token?: string): Request {
  return new Request("https://app.test/api/linki/execute", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

// The handlers option is a union with a functional form; narrow it for tests.
const handler = (Route.options.server!.handlers as { POST: unknown }).POST as (ctx: {
  request: Request;
}) => Promise<Response>;

const EXECUTE = { action_id: "action_1" };

beforeEach(() => {
  createClientCalls.length = 0;
  executeAction.mockReset();
  executeAction.mockResolvedValue({
    action: { status: "executed", executionReceipt: "r1", failureReason: null },
    alreadyDone: false,
  });
  stub = makeStub();
});

describe("POST /api/linki/execute auth gate", () => {
  it("rejects a request with no Authorization header, before touching Supabase", async () => {
    const res = await handler({ request: post(EXECUTE) });
    expect(res.status).toBe(401);
    expect(createClientCalls).toHaveLength(0);
  });

  it("rejects a malformed Authorization header (not a Bearer scheme)", async () => {
    const request = new Request("https://app.test/api/linki/execute", {
      method: "POST",
      headers: { Authorization: "Basic abc123" },
      body: JSON.stringify(EXECUTE),
    });
    const res = await handler({ request });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid or expired session (getUser returns no user)", async () => {
    stub = makeStub({ user: null, userError: { message: "invalid JWT" } });
    const res = await handler({ request: post(EXECUTE, "expired-token") });
    expect(res.status).toBe(401);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user with no active membership", async () => {
    stub = makeStub({ memberships: [{ organization_id: "org_a", status: "revoked" }] });
    const res = await handler({ request: post(EXECUTE, "good-token") });
    expect(res.status).toBe(403);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("resolves membership server-side, filtered by the authenticated user's id", async () => {
    stub = makeStub({
      memberships: [{ organization_id: "org_a" }],
      action: { id: "action_1", organization_id: "org_a" },
    });
    await handler({ request: post(EXECUTE, "good-token") });
    expect(stub.tables).toContain("organization_memberships");
    expect(stub.filters["organization_memberships"]!["user_id"]).toBe("user_1");
  });

  it("refuses to execute an action that belongs to another organization", async () => {
    stub = makeStub({
      memberships: [{ organization_id: "org_a", status: "active" }],
      action: { id: "action_1", organization_id: "org_b" },
    });
    const res = await handler({ request: post(EXECUTE, "good-token") });
    expect(res.status).toBe(403);
    // Nothing from org B may be sent — or returned.
    expect(executeAction).not.toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("org_b");
  });

  it("surfaces a failed membership read as 5xx, never as 'not a member'", async () => {
    stub = makeStub({ membershipError: { message: "permission denied" } });
    const res = await handler({ request: post(EXECUTE, "good-token") });
    expect(res.status).toBe(503);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("executes with the action's server-resolved organization, for a member of it", async () => {
    stub = makeStub({
      memberships: [{ organization_id: "org_a" }],
      action: { id: "action_1", organization_id: "org_a" },
    });
    const res = await handler({ request: post(EXECUTE, "good-token") });
    expect(res.status).toBe(200);
    expect(executeAction).toHaveBeenCalledWith("action_1", {
      organizationId: "org_a",
      userId: "user_1",
    });
  });

  it("uses the publishable key and the caller's own token — never a service-role key", async () => {
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-secret";
    try {
      stub = makeStub({
        memberships: [{ organization_id: "org_a" }],
        action: { id: "action_1", organization_id: "org_a" },
      });
      await handler({ request: post(EXECUTE, "callers-token") });
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
