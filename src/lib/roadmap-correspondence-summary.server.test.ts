import { beforeEach, expect, it, vi } from "vitest";
import { org, roadmapId, relationshipId } from "@/domain/roadmap-correspondence.fixtures";
const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  count: 0,
  denied: false,
  columns: [] as string[],
}));
vi.mock("./roadmap-tracker-access.server", async (original) => {
  const m = await original<typeof import("./roadmap-tracker-access.server")>();
  return {
    ...m,
    authorizeTracker: async () => {
      if (state.denied) throw new m.TrackerRequestError("Denied", 403);
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
              limit: () => q,
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(
                  table === "roadmaps"
                    ? {
                        data: [
                          {
                            id: "00000000-0000-4000-8000-000000000002",
                            relationship_id: "00000000-0000-4000-8000-000000000003",
                          },
                        ],
                        count: 1,
                        error: null,
                      }
                    : { data: state.rows, count: state.count, error: null },
                ).then(resolve),
            };
            return q;
          },
        },
      };
    },
  };
});
import { readConversationSummary } from "./roadmap-correspondence-summary.server";
const req = () =>
  new Request(`https://cmd.test/api/public/roadmap/conversation-summary?organizationId=${org}`);
beforeEach(() => Object.assign(state, { rows: [], count: 0, denied: false, columns: [] }));
it("empty imports do not become zero sent assertions", async () => {
  const b = await (await readConversationSummary(req())).json();
  expect(b.records).toEqual([]);
  expect(JSON.stringify(b)).not.toContain("sentCount");
  expect(state.columns.join()).not.toMatch(/body|subject|sourceAccount/);
});
it("summarizes channel and observed latest activity without reading bodies", async () => {
  state.rows = [
    {
      roadmap_id: roadmapId,
      relationship_id: relationshipId,
      channel: "email",
      kind: "sent",
      at: "2026-11-01T12:00:00Z",
    },
    {
      roadmap_id: roadmapId,
      relationship_id: relationshipId,
      channel: "linkedin_sales_navigator",
      kind: "received",
      at: "2026-11-02T12:00:00Z",
    },
  ];
  state.count = 2;
  const b = await (await readConversationSummary(req())).json();
  expect(b.records[0]).toMatchObject({
    hasSent: true,
    hasReceived: true,
    latest: { channel: "linkedin_sales_navigator", kind: "received" },
    coverage: "partial",
  });
});
it("rejects truncated reads and wrong canonical associations", async () => {
  state.count = 501;
  expect((await readConversationSummary(req())).status).toBe(503);
  state.count = 1;
  state.rows = [
    {
      roadmap_id: roadmapId,
      relationship_id: org,
      channel: "email",
      kind: "sent",
      at: "2026-11-01T12:00:00Z",
    },
  ];
  expect((await readConversationSummary(req())).status).toBe(409);
});
it("denied callers cannot read summaries", async () => {
  state.denied = true;
  expect((await readConversationSummary(req())).status).toBe(403);
  expect(state.columns).toEqual([]);
});
