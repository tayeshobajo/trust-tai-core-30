import { afterEach, expect, it, vi } from "vitest";
import { reviewFixture, reviewScope } from "@/domain/roadmap-correspondence-review.fixtures";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: { auth, rpc } }));
import {
  correspondenceImportAction,
  correspondenceReviewAction,
} from "./roadmap-correspondence-review";
const user = reviewFixture.envelope.approverId;
const session = (id = user, token = "synthetic-session-only") => ({
  error: null,
  data: { session: { user: { id }, access_token: token } },
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("uses only the existing user token and sends exact review scope", async () => {
  auth.getSession.mockResolvedValue(session());
  const fetcher = vi.fn().mockResolvedValue(Response.json(reviewFixture));
  vi.stubGlobal("fetch", fetcher);
  expect(await correspondenceReviewAction(user)(reviewScope, true)).toEqual(reviewFixture);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("/api/public/roadmap/correspondence-review");
  expect(options).toEqual({
    method: "POST",
    headers: { Authorization: "Bearer synthetic-session-only", "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(reviewScope),
  });
});
it("does not call the API after a session/account change", async () => {
  auth.getSession.mockResolvedValue(session(reviewScope.reviewId));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(correspondenceReviewAction(user)(reviewScope)).rejects.toThrow("Sign in again");
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects response text after a token change and mismatched review scope", async () => {
  auth.getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(user, "changed"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(reviewFixture)));
  await expect(correspondenceReviewAction(user)(reviewScope)).rejects.toThrow(
    "scope or session changed",
  );
  auth.getSession.mockResolvedValue(session());
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...reviewFixture, digest: "a".repeat(64) })),
  );
  await expect(correspondenceReviewAction(user)(reviewScope)).rejects.toThrow(
    "scope or session changed",
  );
});
it("fails closed on permission errors and malformed schema", async () => {
  auth.getSession.mockResolvedValue(session());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
  await expect(correspondenceReviewAction(user)(reviewScope)).rejects.toThrow("Review unavailable");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...reviewFixture, envelope: {} })),
  );
  await expect(correspondenceReviewAction(user)(reviewScope)).rejects.toThrow();
});
it("imports only the approved reference through the existing guarded caller RPC", async () => {
  auth.getSession.mockResolvedValue(session());
  const receipt = { batchId: reviewScope.reviewId, inserted: 1, duplicates: 0 };
  rpc.mockResolvedValue({ data: receipt, error: null });
  expect(await correspondenceImportAction(user)(reviewScope)).toEqual(receipt);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("apply_roadmap_correspondence_batch", {
    batch: reviewScope.reviewId,
    expected_digest: reviewScope.expectedDigest,
  });
});
it("does not import with a different or missing session", async () => {
  auth.getSession.mockResolvedValue(session(reviewScope.reviewId));
  await expect(correspondenceImportAction(user)(reviewScope)).rejects.toThrow("Sign in again");
  expect(rpc).not.toHaveBeenCalled();
});
it("does not retry or disclose database errors on failed import", async () => {
  auth.getSession.mockResolvedValue(session());
  rpc.mockResolvedValue({ error: { message: "PRIVATE BODY" } });
  await expect(correspondenceImportAction(user)(reviewScope)).rejects.toThrow("saved receipt");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("rejects another batch receipt, impossible counts and post-call session changes", async () => {
  auth.getSession.mockResolvedValue(session());
  rpc.mockResolvedValueOnce({ data: { batchId: user, inserted: 1, duplicates: 0 }, error: null });
  await expect(correspondenceImportAction(user)(reviewScope)).rejects.toThrow("needs verification");
  rpc.mockResolvedValueOnce({
    data: { batchId: reviewScope.reviewId, inserted: 251, duplicates: 0 },
    error: null,
  });
  await expect(correspondenceImportAction(user)(reviewScope)).rejects.toThrow("needs verification");
  auth.getSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session(user, "changed"));
  rpc.mockResolvedValueOnce({
    data: { batchId: reviewScope.reviewId, inserted: 1, duplicates: 0 },
    error: null,
  });
  await expect(correspondenceImportAction(user)(reviewScope)).rejects.toThrow("needs verification");
});
