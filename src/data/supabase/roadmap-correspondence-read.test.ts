import { afterEach, expect, it, vi } from "vitest";
import {
  event,
  org,
  roadmapId,
  relationshipId,
  userId,
} from "@/domain/roadmap-correspondence.fixtures";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: { auth } }));
import { correspondenceReader } from "./roadmap-correspondence-read";
const session = (id = userId) => ({
  error: null,
  data: { session: { user: { id }, access_token: "synthetic-only" } },
});
const page = {
  organizationId: org,
  roadmapId,
  relationshipId,
  events: [event],
  nextCursor: null,
  coverage: "partial",
  readAt: "2026-11-03T12:00:00Z",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("uses caller token and no-store without a new credential", async () => {
  auth.getSession.mockResolvedValue(session());
  const fetcher = vi.fn().mockResolvedValue(Response.json(page));
  vi.stubGlobal("fetch", fetcher);
  expect(await correspondenceReader(userId)(org, roadmapId)).toEqual(page);
  expect(fetcher.mock.calls[0]![1]).toEqual({
    headers: { Authorization: "Bearer synthetic-only" },
    cache: "no-store",
  });
});
it("discards private text after account switching", async () => {
  auth.getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(org));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(page)));
  await expect(correspondenceReader(userId)(org, roadmapId)).rejects.toThrow("Session changed");
});
it("rejects wrong scope and server errors", async () => {
  auth.getSession.mockResolvedValue(session());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...page, roadmapId: userId })));
  await expect(correspondenceReader(userId)(org, roadmapId)).rejects.toThrow("identity mismatch");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
  await expect(correspondenceReader(userId)(org, roadmapId)).rejects.toThrow("unavailable");
});

it("discards private text when the token changes during a read", async () => {
  const refreshed = session();
  refreshed.data.session.access_token = "synthetic-refreshed";
  auth.getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(refreshed);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(page)));
  await expect(correspondenceReader(userId)(org, roadmapId)).rejects.toThrow("Session changed");
});
