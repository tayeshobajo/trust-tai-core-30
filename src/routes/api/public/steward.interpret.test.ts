import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "viewer",
  override: null as string | null,
  enabled: true,
  fail: false,
  reads: [] as string[],
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/lib/trust-tai-backend.server", () => ({
  trustTaiSupabaseKey: () => "fixture",
  trustTaiSupabaseUrl: () => "https://example.invalid",
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    from: (table: string) => {
      state.reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          error: state.fail ? { message: "unavailable" } : null,
          data:
            table === "organization_memberships"
              ? { role: state.role, status: "active" }
              : table === "organization_app_settings"
                ? { enabled: state.enabled }
                : table === "member_app_access"
                  ? { access_level: state.override }
                  : null,
        }),
      };
      return query;
    },
  }),
}));
import { Route } from "./steward.interpret";
const post = (
  Route as unknown as {
    server: { handlers: { POST: (arg: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;
beforeEach(() => {
  state.role = "viewer";
  state.override = null;
  state.enabled = true;
  state.fail = false;
  state.reads = [];
});
const request = () =>
  new Request("https://example.invalid/api/public/steward/interpret", {
    method: "POST",
    headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" },
    body: JSON.stringify({ organization_id: "org", conversation_id: "meeting" }),
  });
it("denies viewer POST before reading a transcript, invoking a model, or writing a reading", async () => {
  expect((await post({ request: request() })).status).toBe(403);
  expect(state.reads).not.toContain("conversations");
  expect(state.reads).not.toContain("activities");
});
it("denies a member narrowed to view-only even when membership is active", async () => {
  state.role = "admin";
  state.override = "view";
  expect((await post({ request: request() })).status).toBe(403);
  expect(state.reads).not.toContain("activities");
});
it("fails closed when app authority cannot be read", async () => {
  state.role = "admin";
  state.enabled = false;
  expect((await post({ request: request() })).status).toBe(403);
});
