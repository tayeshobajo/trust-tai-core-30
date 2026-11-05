// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), read: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/trust-tai-backend.server", () => ({
  trustTaiSupabaseUrl: () => "https://example.org",
  trustTaiSupabaseKey: () => "publishable-test",
}));
vi.mock("@/lib/rfp-source-url.server", () => ({ readPublicSource: mocks.read }));
import { readRfpSource } from "./rfps.source";
const req = (
  body = JSON.stringify({ organization_id: "org", url: "https://example.org" }),
  token = "test",
) =>
  new Request("https://cmd.example/api/public/rfps/source", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
  mocks.rpc.mockResolvedValue({ data: true });
  mocks.read.mockResolvedValue({ text: "Example source" });
});
it("does not fetch sources without verified authentication", async () => {
  expect((await readRfpSource(req(undefined, ""))).status).toBe(401);
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect((await readRfpSource(req())).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("checks opportunity workspace work access before any external fetch", async () => {
  mocks.rpc.mockResolvedValue({ data: false });
  expect((await readRfpSource(req())).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("rfp_has_access", {
    org: "org",
    scope: "org",
    writing: true,
  });
});
it("bounds input and fails closed for authorized callers without fetching", async () => {
  expect((await readRfpSource(req("x".repeat(4097)))).status).toBe(413);
  expect(mocks.read).not.toHaveBeenCalled();
  const response = await readRfpSource(req());
  expect(response.status).toBe(501);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("not connected") });
});
