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
import { readRoadmapCorrespondence } from "./roadmap-correspondence-read.server";
const req = (suffix = "") =>
  new Request(
    `https://cmd.test/api/public/roadmap/correspondence?organizationId=${org}&roadmapId=${roadmapId}${suffix}`,
  );
const get = async (suffix = "") => {
  const response = await readRoadmapCorrespondence(req(suffix));
  return { response, body: await response.json() };
};
beforeEach(() => {
  state.current = testState();
});
it("returns honest empty coverage with independent Comms access and no provider reads", async () => {
  const { response, body } = await get();
  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    coverage: "unknown",
    events: [],
    sources: { storedGmail: "included", providerSync: "not_checked" },
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Vary")).toBe("Authorization");
  expect(state.current.authCalls).toBe(2);
});
it("merges exact reviewed text and newer stored mail without manufacturing review claims", async () => {
  state.current.reviewed = [reviewedRow()];
  state.current.mail = [mailRow()];
  const { body, response } = await get();
  expect(response.status).toBe(200);
  expect(body.events.map((e: { sourceEventId: string }) => e.sourceEventId)).toEqual([
    "synthetic-1",
    event.sourceEventId,
  ]);
  expect(body.events[1]).toEqual(event);
  expect(body.events[0]).toMatchObject({
    source: "stored_gmail",
    bodyRepresentation: "stored_plain_text",
    kind: "received",
  });
  expect(body.events[0]).not.toHaveProperty("review");
  expect(body.events[0].sourceUrl).toContain("authuser=team%40example.test");
});
it.each(["&after=bad", "&after=" + "a".repeat(64), "&limit=1000", `&roadmapId=${roadmapId}`])(
  "rejects malformed queries %s",
  async (suffix) => {
    expect((await get(suffix)).response.status).toBe(400);
    expect(state.current.reads).toEqual([]);
  },
);
it("does not read private sources without Roadmaps access", async () => {
  state.current.denied = true;
  expect((await get()).response.status).toBe(403);
  expect(state.current.reads).toEqual([]);
});
it.each(["member", "role", "organization", "unknown-role"])(
  "requires independent Comms entitlement (%s)",
  async (level) => {
    state.current.reviewed = [reviewedRow()];
    state.current.mail = [mailRow()];
    if (level === "member") state.current.memberOverride = "hidden";
    if (level === "role") state.current.roleOverride = "hidden";
    if (level === "organization") state.current.orgEnabled = false;
    if (level === "unknown-role") state.current.membershipRole = "unknown";
    const { body, response } = await get();
    expect(response.status).toBe(200);
    expect(body.events).toEqual([event]);
    expect(body.sources.storedGmail).toBe("not_authorized");
    expect(state.current.reads.some((r) => r.table === "comms_messages")).toBe(false);
  },
);
it.each(["loseAccess", "changeMapping", "changeUser", "loseCommsAccess"] as const)(
  "rechecks %s before releasing bodies",
  async (key) => {
    state.current[key] = true;
    state.current.reviewed = [reviewedRow()];
    state.current.mail = [mailRow()];
    const { response, body } = await get();
    expect([401, 403, 409]).toContain(response.status);
    expect(JSON.stringify(body)).not.toContain("SYNTHETIC");
  },
);
it.each(["roadmap_correspondence_events", "comms_messages"])(
  "does not turn %s failures or truncation into empty history",
  async (table) => {
    state.current.reviewed = [reviewedRow()];
    state.current.mail = [mailRow()];
    state.current.errorTable = table;
    expect((await get()).response.status).toBe(503);
    state.current.errorTable = "";
    state.current.truncateTable = table;
    expect((await get()).response.status).toBe(503);
  },
);
it("fails closed on permission lookup errors", async () => {
  state.current.permissionError = true;
  expect((await get()).response.status).toBe(503);
  expect(state.current.reads.some((r) => r.table === "comms_messages")).toBe(false);
});
it("rejects cross-scope metadata and bodies", async () => {
  state.current.reviewed = [reviewedRow({ ...event, roadmapId: userId })];
  expect((await get()).response.status).toBe(503);
  state.current.reviewed = [];
  state.current.mail = [{ ...mailRow(), relationship_id: org }];
  expect((await get()).response.status).toBe(503);
  state.current.mail = [mailRow()];
  state.current.corruptBody = true;
  expect((await get()).response.status).toBe(409);
});
it("reads all 728 metadata records but only this newest page's bodies; continuation is stable", async () => {
  state.current.mail = Array.from({ length: 728 }, (_, i) => mailRow(i + 1));
  const { response, body } = await get();
  expect(response.status).toBe(200);
  expect(body.events).toHaveLength(25);
  expect(body.nextCursor).toMatch(/^[a-f0-9]{64}\.25$/);
  const metadataReads = state.current.reads.filter(
    (r) => r.table === "comms_messages" && !r.columns.includes("body_text"),
  );
  expect(metadataReads.map((r) => r.range)).toEqual([
    [0, 499],
    [500, 999],
  ]);
  const bodies = state.current.reads.find((r) => r.columns.includes("body_text"))!;
  expect(bodies.filters).toContainEqual(["organization_id", org]);
  expect(bodies.filters).toContainEqual(["relationship_id", relationshipId]);
  expect(bodies.filters.find(([key]) => key === "in:id")?.[1]).toHaveLength(25);
  const next = await get(`&after=${body.nextCursor}`);
  expect(next.response.status).toBe(200);
  expect(next.body.events).toHaveLength(25);
  expect(new Set([...body.events, ...next.body.events].map((e) => e.sourceEventId)).size).toBe(50);
});
it("invalidates pagination when stored source observations change", async () => {
  state.current.mail = Array.from({ length: 26 }, (_, i) => mailRow(i + 1));
  const { body } = await get();
  state.current.mail[0]!.fetched_at = "2026-11-06T12:01:00Z";
  expect((await get(`&after=${body.nextCursor}`)).response.status).toBe(409);
});
it("deduplicates only same mailbox/provider and preserves reviewed redactions", async () => {
  state.current.reviewed = [
    reviewedRow({
      ...event,
      sourceAccountRef: "TEAM@example.test",
      sourceEventId: "synthetic-1",
      kind: "received",
      occurredAt: mailRow().occurred_at,
    }),
  ];
  state.current.mail = [
    mailRow(),
    { ...mailRow(2), provider_message_id: "synthetic-1", mailbox: "other@example.test" },
  ];
  const { response, body } = await get();
  expect(response.status).toBe(200);
  expect(body.events).toHaveLength(2);
  expect(body.events.find((r: { review?: unknown }) => r.review).bodyText).toBe(event.bodyText);
  expect(JSON.stringify(body)).not.toContain("SYNTHETIC PRIVATE 1");
});
it("refuses conflicting same-account facts", async () => {
  state.current.reviewed = [
    reviewedRow({ ...event, sourceAccountRef: "team@example.test", sourceEventId: "synthetic-1" }),
  ];
  state.current.mail = [mailRow()];
  expect((await get()).response.status).toBe(503);
});
it("labels snippet-only content and omits unattributed legacy mail without guessing an account", async () => {
  state.current.mail = [
    { ...mailRow(), body_text: "" },
    { ...mailRow(2), mailbox: "" },
  ];
  const { body } = await get();
  expect(body.events).toHaveLength(1);
  expect(body.events[0]).toMatchObject({
    bodyRepresentation: "stored_snippet",
    bodyText: "Synthetic snippet",
  });
  expect(body.sources.omittedUnattributed).toBe(1);
});
it("a roadmap without a canonical relationship never guesses or reads messages", async () => {
  state.current.mappings[0]!.relationship_id = null;
  const { response, body } = await get();
  expect(response.status).toBe(200);
  expect(body.sources.storedGmail).toBe("not_linked");
  expect(state.current.reads.map((r) => r.table)).toEqual(["roadmaps", "roadmaps"]);
});
