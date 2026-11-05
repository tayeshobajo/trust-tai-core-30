import { afterEach, expect, it, vi } from "vitest";
import { org, user } from "@/domain/roadmap-correspondence.fixtures";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: { auth } }));
import { listApprovedCorrespondenceFacts } from "./comms-approved-correspondence";
const session = (id = user, token = "synthetic-only") => ({
  error: null,
  data: { session: { user: { id }, access_token: token } },
});
const page = {
  organizationId: org,
  readAt: "2026-11-05T12:00:00Z",
  coverage: "partial",
  facts: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("uses only the existing caller session and scoped metadata endpoint", async () => {
  auth.getSession.mockResolvedValue(session());
  const fetcher = vi.fn().mockResolvedValue(Response.json(page));
  vi.stubGlobal("fetch", fetcher);
  expect(await listApprovedCorrespondenceFacts(org, user)).toEqual([]);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    `/api/public/roadmap/conversation-summary?organizationId=${org}&mode=comms`,
    { headers: { Authorization: "Bearer synthetic-only" }, cache: "no-store" },
  );
});
it("does not read for an already changed identity", async () => {
  auth.getSession.mockResolvedValue(session(org));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(listApprovedCorrespondenceFacts(org, user)).rejects.toThrow("Session changed");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([session(org), session(user, "changed-token")])(
  "discards metadata when identity/session changes during read",
  async (next) => {
    auth.getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(next);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(page)));
    await expect(listApprovedCorrespondenceFacts(org, user)).rejects.toThrow("scope changed");
  },
);
it("rejects denied access and wrong organization rather than reporting empty success", async () => {
  auth.getSession.mockResolvedValue(session());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
  await expect(listApprovedCorrespondenceFacts(org, user)).rejects.toThrow("unavailable");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...page, organizationId: user })),
  );
  await expect(listApprovedCorrespondenceFacts(org, user)).rejects.toThrow("scope changed");
});
