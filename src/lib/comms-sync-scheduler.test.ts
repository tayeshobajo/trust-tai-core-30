import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  status: "error",
  cursor: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  filters: [] as unknown[][],
  rpc: vi.fn(),
}));
vi.mock("@/lib/comms-crypto.server", () => ({
  openSecret: async () => "synthetic-refresh",
  sealSecret: vi.fn(),
}));
vi.mock("@/lib/comms-outcome-fill.server", () => ({
  recordSilenceObservations: async () => {},
  recordInboundReply: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: state.rpc,
    from: () => {
      let update: Record<string, unknown> | undefined;
      const q = {
        select: () => q,
        in: (...args: unknown[]) => {
          state.filters.push(args);
          return q;
        },
        eq: () => q,
        update: (u: Record<string, unknown>) => {
          update = u;
          state.updates.push(u);
          return q;
        },
        maybeSingle: async () => ({
          data: { status: state.status, cursor: state.cursor, updated_at: "rev" },
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: update
              ? []
              : [
                  {
                    id: "i",
                    organization_id: "o",
                    account_email: "me@example.test",
                    status: state.status,
                    cursor: state.cursor,
                    updated_at: "rev",
                  },
                ],
            error: null,
          }).then(resolve),
      };
      return q;
    },
  }),
}));
import { syncAllConnectedMailboxes } from "./comms-gmail.server";
beforeEach(() => {
  state.status = "error";
  state.cursor = {};
  state.updates = [];
  state.filters = [];
  state.rpc.mockReset().mockResolvedValue({ data: "sealed", error: null });
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test");
  vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "synthetic-test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("attempts due error mailboxes and saves backoff on transient token errors without revocation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 503 }),
    ),
  );
  const result = await syncAllConnectedMailboxes();
  expect(result.failed).toBe(1);
  expect(state.filters).toContainEqual(["status", ["connected", "error"]]);
  expect(state.updates.at(-1)).toMatchObject({
    status: "error",
    cursor: { retry: { failures: 1 }, last_run: { outcome: "failed" } },
  });
  expect(state.updates.some((u) => u["status"] === "revoked")).toBe(false);
});
it("does not contact a mailbox while its backoff is pending", async () => {
  state.cursor = { retry: { next_at: new Date(Date.now() + 3600000).toISOString() } };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const result = await syncAllConnectedMailboxes();
  expect(result.mailboxes).toBe(1);
  expect(result.deferred).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
  expect(state.rpc).not.toHaveBeenCalled();
});
it("only explicit invalid_grant triggers revoked status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })),
  );
  await syncAllConnectedMailboxes();
  expect(state.updates[0]).toMatchObject({ status: "revoked" });
});
