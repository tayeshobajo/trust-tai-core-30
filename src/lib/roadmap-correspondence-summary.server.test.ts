import { beforeEach, expect, it, vi } from "vitest";
import {
  event,
  org,
  roadmapId,
  relationshipId,
  userId,
  testState,
  mailRow,
  reviewedRow,
  type TestState,
} from "./roadmap-stored-mail.test-fixtures";
const state = vi.hoisted(() => ({ current: {} as TestState }));
vi.mock("./roadmap-tracker-access.server", async (original) => {
  const source = await original<typeof import("./roadmap-tracker-access.server")>();
  const { fakeClient } = await import("./roadmap-stored-mail.test-fixtures");
  return {
    ...source,
    authorizeTracker: async () => {
      const s = state.current;
      s.authCalls++;
      if (s.denied || (s.loseAccess && s.authCalls > 1))
        throw new source.TrackerRequestError("Denied", 403);
      return {
        user: { id: s.changeUser && s.authCalls > 1 ? org : userId },
        client: fakeClient(s),
      };
    },
  };
});
import { readConversationSummary } from "./roadmap-correspondence-summary.server";
const req = () =>
  new Request(`https://cmd.test/api/public/roadmap/conversation-summary?organizationId=${org}`);
const get = async () => {
  const response = await readConversationSummary(req());
  return { response, body: await response.json() };
};
beforeEach(() => {
  state.current = testState();
});
it("empty history remains unknown, not zero sent", async () => {
  const { response, body } = await get();
  expect(response.status).toBe(200);
  expect(body.records).toEqual([]);
  expect(JSON.stringify(body)).not.toContain("sentCount");
});
it("reports newer stored mail as latest activity without reading or returning content", async () => {
  state.current.reviewed = [reviewedRow()];
  state.current.mail = [mailRow()];
  const { response, body } = await get();
  expect(response.status).toBe(200);
  expect(body.records[0]).toMatchObject({
    roadmapId,
    hasSent: true,
    hasReceived: true,
    latest: {
      channel: "email",
      kind: "received",
      at: "2026-11-05T12:00:00Z",
      source: "stored_gmail",
    },
    coverage: "partial",
  });
  expect(state.current.reads.map((r) => r.columns).join()).not.toMatch(
    /body|subject|snippet|headers|attachments|sourceUrl/,
  );
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE|team@example|synthetic-1|reviewerId/);
});
it("paginates 728 facts so the latest can come from a later metadata page", async () => {
  state.current.mail = Array.from({ length: 728 }, (_, i) => ({
    ...mailRow(i + 1),
    occurred_at: i === 727 ? "2026-11-06T15:00:00Z" : "2026-11-05T12:00:00Z",
  }));
  const { response, body } = await get();
  expect(response.status).toBe(200);
  expect(body.records[0].latest.at).toBe("2026-11-06T15:00:00Z");
  expect(
    state.current.reads.filter((r) => r.table === "comms_messages").map((r) => r.range),
  ).toEqual([
    [0, 499],
    [500, 999],
  ]);
});
it("keeps actual correspondence ahead of a newer unsent draft", async () => {
  state.current.reviewed = [
    reviewedRow({ ...event, kind: "draft", occurredAt: "2026-11-06T16:00:00Z" }),
  ];
  state.current.mail = [mailRow()];
  const { body } = await get();
  expect(body.records[0].latest.kind).toBe("received");
  expect(body.records[0].hasSent).toBe(false);
});
it("does not expose any stored-mail metadata to Roadmaps-only members", async () => {
  state.current.memberOverride = "hidden";
  state.current.reviewed = [reviewedRow()];
  state.current.mail = [mailRow()];
  const { body } = await get();
  expect(body.records[0].latest.source).toBe("reviewed_import");
  expect(body.sources.storedGmail).toBe("not_authorized");
  expect(state.current.reads.some((r) => r.table === "comms_messages")).toBe(false);
});
it.each(["loseAccess", "loseCommsAccess", "changeMapping", "changeUser"] as const)(
  "rechecks %s before returning facts",
  async (key) => {
    state.current[key] = true;
    state.current.mail = [mailRow()];
    const { response, body } = await get();
    expect([401, 403, 409]).toContain(response.status);
    expect(body).not.toHaveProperty("records");
  },
);
it("rejects wrong canonical associations", async () => {
  state.current.reviewed = [reviewedRow({ ...event, relationshipId: org })];
  expect((await get()).response.status).toBe(409);
  state.current.reviewed = [];
  state.current.mail = [{ ...mailRow(), relationship_id: org }];
  expect((await get()).response.status).toBe(503);
});
it("fails visibly when a count changes, a page is truncated, or the metadata budget is exceeded", async () => {
  state.current.mail = Array.from({ length: 728 }, (_, i) => mailRow(i + 1));
  state.current.countChanges = true;
  expect((await get()).response.status).toBe(503);
  state.current.countChanges = false;
  state.current.truncateTable = "comms_messages";
  expect((await get()).response.status).toBe(503);
  state.current.truncateTable = "";
  state.current.countOverride = 10001;
  expect((await get()).response.status).toBe(503);
});
it("denied callers cannot read summaries", async () => {
  state.current.denied = true;
  expect((await get()).response.status).toBe(403);
  expect(state.current.reads).toEqual([]);
});
it("rejects conflicting copies and retains reviewed-source precedence for exact duplicates", async () => {
  state.current.mail = [mailRow()];
  state.current.reviewed = [
    reviewedRow({
      ...event,
      sourceAccountRef: "team@example.test",
      sourceEventId: "synthetic-1",
      kind: "received",
      occurredAt: mailRow().occurred_at,
    }),
  ];
  expect((await get()).body.records[0].latest.source).toBe("reviewed_import");
  state.current.reviewed[0]!.event_payload.kind = "sent";
  expect((await get()).response.status).toBe(503);
});
it("uses exact canonical relationships only and leaves null mappings unlinked", async () => {
  state.current.mappings[0]!.relationship_id = null;
  const { body } = await get();
  expect(body.records).toEqual([]);
  expect(state.current.reads.some((r) => r.table === "comms_messages")).toBe(false);
});
