import { beforeEach, expect, it, vi } from "vitest";
import { event, org, roadmap, relationship } from "@/domain/roadmap-correspondence.fixtures";
const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  count: 0,
  denied: false,
  denyRecheck: false,
  authCalls: 0,
  mappingReads: 0,
  changed: false,
  columns: [] as string[],
  error: false,
}));
vi.mock("./roadmap-tracker-access.server", async (original) => {
  const actual = await original<typeof import("./roadmap-tracker-access.server")>();
  return {
    ...actual,
    authorizeTracker: async () => {
      state.authCalls++;
      if (state.denied || (state.denyRecheck && state.authCalls > 1))
        throw new actual.TrackerRequestError("Denied", 403);
      return {
        user: { id: "caller" },
        client: {
          from: (table: string) => {
            const q = {
              select: (c: string) => {
                state.columns.push(c);
                return q;
              },
              eq: () => q,
              order: () => q,
              limit: () => q,
              then: (resolve: (v: unknown) => unknown) => {
                if (table === "roadmaps") state.mappingReads++;
                return Promise.resolve(
                  table === "roadmaps"
                    ? {
                        data: [
                          {
                            id: "00000000-0000-4000-8000-000000000002",
                            relationship_id:
                              state.changed && state.mappingReads > 1
                                ? null
                                : "00000000-0000-4000-8000-000000000003",
                          },
                        ],
                        count: 1,
                        error: null,
                      }
                    : {
                        data: state.rows,
                        count: state.count,
                        error: state.error ? { message: "unavailable" } : null,
                      },
                ).then(resolve);
              },
            };
            return q;
          },
        },
      };
    },
  };
});
import { readApprovedCommsFacts } from "./comms-approved-correspondence.server";
import { readConversationSummary } from "./roadmap-correspondence-summary.server";
const req = (suffix = "") =>
  new Request(
    `https://cmd.test/api/public/roadmap/conversation-summary?organizationId=${org}&mode=comms${suffix}`,
  );
const row = () => ({
  eventKey: "a".repeat(64),
  organizationId: org,
  roadmapId: roadmap,
  relationshipId: relationship,
  channel: event.channel,
  kind: event.kind,
  occurredAt: event.occurredAt,
  timestampPrecision: event.timestampPrecision,
  sourceAccountRef: event.sourceAccountRef,
  sourceEventId: event.sourceEventId,
  identityKind: event.identityKind,
  review: event.review,
  payloadOrganizationId: org,
  payloadRoadmapId: roadmap,
  payloadRelationshipId: relationship,
});
beforeEach(() =>
  Object.assign(state, {
    rows: [row()],
    count: 1,
    denied: false,
    denyRecheck: false,
    authCalls: 0,
    mappingReads: 0,
    changed: false,
    columns: [],
    error: false,
  }),
);
it("reuses Roadmaps authorization, reads metadata only and strips review internals", async () => {
  const response = await readConversationSummary(req());
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.facts).toHaveLength(1);
  expect(result.coverage).toBe("partial");
  expect(state.authCalls).toBe(2);
  expect(state.mappingReads).toBe(2);
  expect(state.columns.join()).not.toMatch(/body|subject|sourceUrl/);
  expect(JSON.stringify(result)).not.toMatch(/bodyText|reviewerId|sourceRef|payloadOrganization/);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("denied Roadmaps access never falls back to organization membership or a service key", async () => {
  state.denied = true;
  expect((await readApprovedCommsFacts(req())).status).toBe(403);
  expect(state.columns).toEqual([]);
});
it.each(["denyRecheck", "changed"] as const)("rejects scope changes at %s", async (key) => {
  state[key] = true;
  expect((await readApprovedCommsFacts(req())).status).toBe(key === "changed" ? 409 : 403);
});
it("rejects truncated/error reads instead of presenting empty or complete activity", async () => {
  state.count = 501;
  expect((await readApprovedCommsFacts(req())).status).toBe(503);
  state.count = 2;
  expect((await readApprovedCommsFacts(req())).status).toBe(503);
  state.count = 1;
  state.error = true;
  expect((await readApprovedCommsFacts(req())).status).toBe(503);
});
it.each(["organizationId", "relationshipId", "payloadRelationshipId"])(
  "rejects mismatched %s",
  async (key) => {
    state.rows = [{ ...row(), [key]: "00000000-0000-4000-8000-000000000099" }];
    expect((await readApprovedCommsFacts(req())).status).toBe(409);
  },
);
it("rejects unapproved/unsafe review metadata and duplicate event identities", async () => {
  state.rows = [{ ...row(), review: { ...event.review, secretsExcluded: false } }];
  expect((await readApprovedCommsFacts(req())).status).toBe(503);
  state.rows = [row(), row()];
  state.count = 2;
  expect((await readApprovedCommsFacts(req())).status).toBe(409);
});
it("rejects ambiguous query parameters and never accepts another scope field", async () => {
  expect((await readApprovedCommsFacts(req("&mode=comms"))).status).toBe(400);
  expect((await readApprovedCommsFacts(req("&mailbox=all"))).status).toBe(400);
});
