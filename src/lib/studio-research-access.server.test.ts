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
import { authorizeStudioResearch } from "./studio-research-access.server";
const request = (token = "session") =>
  new Request("https://preview.test/", {
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
it("refuses anonymous callers before data access", async () => {
  await expect(authorizeStudioResearch(request(""), "org")).rejects.toMatchObject({ status: 401 });
  expect(reads).toEqual([]);
});
it.each(["inactive", "invited"])("refuses %s membership", async (status) => {
  state.status = status;
  await expect(authorizeStudioResearch(request(), "org")).rejects.toMatchObject({ status: 403 });
});
it("refuses revoked sessions", async () => {
  state.user = "";
  await expect(authorizeStudioResearch(request(), "org")).rejects.toMatchObject({ status: 401 });
});
it("honors hidden overrides", async () => {
  state.override = "hidden";
  await expect(authorizeStudioResearch(request(), "org")).rejects.toMatchObject({ status: 403 });
});
it("view access cannot dispatch", async () => {
  state.override = "view";
  await expect(authorizeStudioResearch(request(), "org", true)).rejects.toMatchObject({
    status: 403,
  });
  await expect(authorizeStudioResearch(request(), "org")).resolves.toBeTruthy();
});
it("disabled app fails closed", async () => {
  state.enabled = false;
  await expect(authorizeStudioResearch(request(), "org", true)).rejects.toMatchObject({
    status: 403,
  });
});
it("permission reads fail closed", async () => {
  state.fail = true;
  await expect(authorizeStudioResearch(request(), "org")).rejects.toBeTruthy();
});
it("allows current owner work", async () => {
  await expect(authorizeStudioResearch(request(), "org", true)).resolves.toMatchObject({
    user: { id: "u" },
  });
});
