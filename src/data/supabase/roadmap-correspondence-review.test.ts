import { afterEach, expect, it, vi } from "vitest";
import { reviewFixture, reviewScope } from "@/domain/roadmap-correspondence-review.fixtures";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: { auth } }));
import { correspondenceReviewAction } from "./roadmap-correspondence-review";
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
