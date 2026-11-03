import { beforeEach, expect, it, vi } from "vitest";
import {
  event,
  org,
  roadmapId,
  relationshipId,
  userId,
} from "@/domain/roadmap-correspondence.fixtures";
const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  mapping: {} as Record<string, unknown> | null,
  reads: [] as string[],
  filters: [] as unknown[],
  denied: false,
  error: false,
  authCalls: 0,
  loseAccess: false,
  changeMapping: false,
}));
vi.mock("./roadmap-tracker-access.server", async (original) => {
  const source = await original<typeof import("./roadmap-tracker-access.server")>();
  return {
    ...source,
    authorizeTracker: async () => {
      state.authCalls++;
      if (state.denied || (state.loseAccess && state.authCalls > 1))
        throw new source.TrackerRequestError("Denied", 403);
      return {
        user: { id: "00000000-0000-4000-8000-000000000004" },
        client: {
          from: (table: string) => {
            state.reads.push(table);
            const q = {
              select: () => q,
              eq: (...args: unknown[]) => {
                state.filters.push(args);
                return q;
              },
              order: () => q,
              limit: () => q,
              gt: (...args: unknown[]) => {
                state.filters.push(args);
                return q;
              },
              maybeSingle: async () => ({
                data:
                  state.changeMapping && state.authCalls > 1
                    ? { ...state.mapping, relationship_id: null }
                    : state.mapping,
                error: null,
              }),
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: state.rows, error: state.error ? {} : null }).then(resolve),
            };
            return q;
          },
        },
      };
    },
  };
});
import { readRoadmapCorrespondence } from "./roadmap-correspondence-read.server";
const req = (suffix = "") =>
  new Request(
    `https://cmd.test/api/public/roadmap/correspondence?organizationId=${org}&roadmapId=${roadmapId}${suffix}`,
  );
beforeEach(() =>
  Object.assign(state, {
    rows: [],
    mapping: { id: roadmapId, organization_id: org, relationship_id: relationshipId },
    reads: [],
    filters: [],
    denied: false,
    error: false,
    authCalls: 0,
    loseAccess: false,
    changeMapping: false,
  }),
);
it("returns unknown empty coverage and queries only approved storage", async () => {
  const r = await readRoadmapCorrespondence(req());
  expect(r.status).toBe(200);
  const b = await r.json();
  expect(b.coverage).toBe("unknown");
  expect(b.events).toEqual([]);
  expect(state.reads).toEqual(["roadmaps", "roadmap_correspondence_events", "roadmaps"]);
  expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  expect(r.headers.get("Vary")).toBe("Authorization");
});
it("returns exact reviewed text without extra storage fields", async () => {
  state.rows = [
    { event_key: "a".repeat(64), event_payload: event, unrelated_private: "DO NOT RELEASE" },
  ];
  const r = await readRoadmapCorrespondence(req());
  const b = await r.json();
  expect(b.events).toEqual([event]);
  expect(JSON.stringify(b)).not.toContain("DO NOT RELEASE");
  expect(b.coverage).toBe("partial");
});
it.each(["&after=bad", "&limit=1000", `&roadmapId=${roadmapId}`])(
  "rejects invalid pagination or duplicate parameters %s",
  async (s) => {
    expect((await readRoadmapCorrespondence(req(s))).status).toBe(400);
    expect(state.reads).toEqual([]);
  },
);
it("fails closed before reading rows on access denial", async () => {
  state.denied = true;
  expect((await readRoadmapCorrespondence(req())).status).toBe(403);
  expect(state.reads).toEqual([]);
});
it.each(["loseAccess", "changeMapping"] as const)(
  "clears response if %s occurs during read",
  async (k) => {
    state[k] = true;
    state.rows = [{ event_key: "a".repeat(64), event_payload: event }];
    const r = await readRoadmapCorrespondence(req());
    expect([403, 409]).toContain(r.status);
    expect(await r.text()).not.toContain(event.bodyText);
  },
);
it("does not turn database failure into an empty conversation", async () => {
  state.error = true;
  expect((await readRoadmapCorrespondence(req())).status).toBe(503);
});
it("rejects a wrong-roadmap event even if the adapter returns it", async () => {
  state.rows = [{ event_key: "a".repeat(64), event_payload: { ...event, roadmapId: userId } }];
  expect((await readRoadmapCorrespondence(req())).status).toBe(503);
});
it("returns stable page cursor and applies all scope filters", async () => {
  state.rows = Array.from({ length: 26 }, (_, i) => ({
    event_key: i.toString(16).padStart(64, "0"),
    event_payload: { ...event, sourceEventId: `synthetic-${i}` },
  }));
  const b = await (await readRoadmapCorrespondence(req())).json();
  expect(b.events).toHaveLength(25);
  expect(b.nextCursor).toBe((24).toString(16).padStart(64, "0"));
  expect(state.filters).toContainEqual(["relationship_id", relationshipId]);
});
it("a roadmap without a relationship reads no message table", async () => {
  state.mapping!["relationship_id"] = null;
  expect((await readRoadmapCorrespondence(req())).status).toBe(200);
  expect(state.reads).not.toContain("roadmap_correspondence_events");
});
