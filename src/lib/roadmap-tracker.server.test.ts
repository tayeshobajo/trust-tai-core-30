import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: "u",
  status: "active",
  role: "owner",
  enabled: true,
  override: null as string | null,
  fail: false,
}));
const reads = vi.hoisted(() => [] as string[]);
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user ? { id: state.user } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          error: state.fail ? { message: "unavailable" } : null,
          data:
            table === "organization_memberships"
              ? { status: state.status, role: state.role }
              : table === "organization_app_settings"
                ? { enabled: state.enabled }
                : table === "member_app_access" && state.override
                  ? { access_level: state.override }
                  : null,
        }),
      };
      return query;
    },
  }),
}));
import { readTrackerBaseline } from "./roadmap-tracker.server";
const organizationId = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const request = (token = "session", org = organizationId) =>
  new Request(`https://preview.test/api/public/roadmap/tracker-preview?organizationId=${org}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
beforeEach(() => {
  Object.assign(state, {
    user: "u",
    status: "active",
    role: "owner",
    enabled: true,
    override: null,
    fail: false,
  });
  reads.length = 0;
});
it("requires bearer auth before touching any source", async () => {
  expect((await readTrackerBaseline(request(""))).status).toBe(401);
  expect(reads).toEqual([]);
});
it("rejects another organization without returning source", async () => {
  expect((await readTrackerBaseline(request("session", "other"))).status).toBe(403);
  expect(reads).toEqual([]);
});
it("rejects a revoked session", async () => {
  state.user = "";
  expect((await readTrackerBaseline(request())).status).toBe(401);
});
it("rejects inactive membership", async () => {
  state.status = "inactive";
  expect((await readTrackerBaseline(request())).status).toBe(403);
});
it("honors hidden room override", async () => {
  state.override = "hidden";
  expect((await readTrackerBaseline(request())).status).toBe(403);
});
it("honors organization room disable", async () => {
  state.enabled = false;
  expect((await readTrackerBaseline(request())).status).toBe(403);
});
it("fails closed on permission read errors", async () => {
  state.fail = true;
  expect((await readTrackerBaseline(request())).status).toBe(403);
});
it("returns only the verified snapshot with no cache and no writes", async () => {
  const response = await readTrackerBaseline(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect((await response.json()).rows).toHaveLength(12);
  expect(reads).toEqual([
    "organization_memberships",
    "organization_app_settings",
    "member_app_access",
    "organization_role_app_access",
  ]);
});
