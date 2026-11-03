import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown> | null,
  error: null as unknown,
  denied: false,
  reads: [] as string[],
  filters: [] as unknown[],
}));
vi.mock("./roadmap-tracker-access.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("./roadmap-tracker-access.server")>();
  return {
    ...original,
    authorizeTracker: async () => {
      if (state.denied) throw new original.TrackerRequestError("Denied", 403);
      return {
        client: {
          from: (table: string) => {
            state.reads.push(table);
            const q = {
              select: () => q,
              eq: (...args: unknown[]) => {
                state.filters.push(args);
                return q;
              },
              maybeSingle: async () => ({ data: state.data, error: state.error }),
            };
            return q;
          },
        },
      };
    },
  };
});
import { readRoadmapEvidence } from "./roadmap-evidence-read.server";
const org = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const id = "426f1f60-2543-4342-9bcb-87d5f16a299d";
const req = () =>
  new Request(`https://cmd.test/api/public/roadmap/evidence?organizationId=${org}&roadmapId=${id}`);
beforeEach(() =>
  Object.assign(state, {
    data: { id, status: "draft", body_text: "SECRET", metadata: { private: "SECRET" } },
    error: null,
    denied: false,
    reads: [],
    filters: [],
  }),
);
it("returns only canonical facts, never reads mailbox tables and retains unknown coverage", async () => {
  const response = await readRoadmapEvidence(req());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(JSON.stringify(body)).not.toContain("SECRET");
  expect(state.reads).toEqual(["roadmaps"]);
  expect(state.filters).toEqual([
    ["organization_id", org],
    ["id", id],
  ]);
  expect(body.evidence.sentCount).toBeNull();
  expect(body.evidence.interactions).toBeNull();
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("does not query rows when room authorization fails", async () => {
  state.denied = true;
  expect((await readRoadmapEvidence(req())).status).toBe(403);
  expect(state.reads).toEqual([]);
});
it("distinguishes source failure from empty evidence", async () => {
  state.error = { message: "unavailable" };
  expect((await readRoadmapEvidence(req())).status).toBe(503);
});
it("does not cross workspace boundaries on absent rows", async () => {
  state.data = null;
  expect((await readRoadmapEvidence(req())).status).toBe(404);
});
it("rejects malformed identity before any reads", async () => {
  expect(
    (await readRoadmapEvidence(new Request("https://cmd.test/api/public/roadmap/evidence"))).status,
  ).toBe(400);
  expect(state.reads).toEqual([]);
});
