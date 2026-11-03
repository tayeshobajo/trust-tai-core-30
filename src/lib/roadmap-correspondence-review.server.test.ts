import { beforeEach, expect, it, vi } from "vitest";
import { reviewFixture, reviewScope } from "@/domain/roadmap-correspondence-review.fixtures";
import { user } from "@/domain/roadmap-correspondence.fixtures";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock("./roadmap-tracker-access.server", async (original) => ({
  ...(await original<typeof import("./roadmap-tracker-access.server")>()),
  authorizeTracker: mocks.authorize,
}));
import { reviewRoadmapCorrespondence } from "./roadmap-correspondence-review.server";
import { TrackerRequestError } from "./roadmap-tracker-access.server";
const req = (body: unknown = reviewScope) =>
  new Request("https://cmd.example/api/public/roadmap/correspondence-review", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ user: { id: user }, client: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({
    data: { ...reviewFixture, approvedAt: "2026-11-03T12:00:00Z", approvedBy: user },
    error: null,
  });
});
it("validates the session and sends no approver or payload supplied by the client", async () => {
  const response = await reviewRoadmapCorrespondence(req());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("review_roadmap_correspondence", {
    b: reviewScope.reviewId,
    org: reviewScope.organizationId,
    expected: reviewScope.expectedDigest,
    confirm: true,
  });
  expect(mocks.authorize).toHaveBeenCalledTimes(2);
});
it("rejects client-supplied approval identity or bodies", async () => {
  expect(
    (await reviewRoadmapCorrespondence(req({ ...reviewScope, approvedBy: user }))).status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("denies unauthenticated callers without touching the RPC", async () => {
  mocks.authorize.mockRejectedValue(new TrackerRequestError("Sign in", 401));
  expect((await reviewRoadmapCorrespondence(req())).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not leak database errors or text on rejected review", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "PRIVATE BODY" } });
  const response = await reviewRoadmapCorrespondence(req());
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("PRIVATE BODY");
});
it("rejects mismatched envelope, malformed real schema and changed sessions", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: { ...reviewFixture, envelope: { ...reviewFixture.envelope, organizationId: user } },
    error: null,
  });
  expect((await reviewRoadmapCorrespondence(req())).status).toBe(503);
  mocks.rpc.mockResolvedValueOnce({
    data: {
      ...reviewFixture,
      envelope: {
        ...reviewFixture.envelope,
        selections: [{ event: {}, mappingDigest: "c".repeat(64) }],
      },
    },
    error: null,
  });
  expect((await reviewRoadmapCorrespondence(req())).status).toBe(503);
  mocks.authorize
    .mockResolvedValueOnce({ user: { id: user }, client: { rpc: mocks.rpc } })
    .mockResolvedValueOnce({ user: { id: reviewScope.reviewId }, client: { rpc: mocks.rpc } });
  expect((await reviewRoadmapCorrespondence(req())).status).toBe(401);
});
it("GET reads the review without confirming", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: reviewFixture, error: null });
  const response = await reviewRoadmapCorrespondence(
    new Request(`https://cmd.example/review?${new URLSearchParams(reviewScope)}`),
  );
  expect(response.status).toBe(200);
  expect(mocks.rpc.mock.calls[0]![1].confirm).toBe(false);
});
