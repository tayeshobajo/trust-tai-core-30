import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  result: { data: [] as unknown[], error: null as null | { message: string } },
  eq: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: () => {
      const request = {
        select: mock.select,
        eq: mock.eq,
        limit: mock.limit,
        order: vi.fn(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(mock.result).then(resolve),
      };
      for (const fn of [request.select, request.eq, request.limit, request.order])
        fn.mockReturnValue(request);
      return request;
    },
  },
}));
import { getRelationshipMessage, listRelationshipMessages } from "./comms-messages";
beforeEach(() => {
  vi.clearAllMocks();
  mock.result = { data: [], error: null };
});
it("reads a single target with organization, relationship and message constraints", async () => {
  await getRelationshipMessage("org", "person", "target");
  expect(mock.eq.mock.calls).toEqual([
    ["organization_id", "org"],
    ["relationship_id", "person"],
    ["id", "target"],
  ]);
  expect(mock.limit).toHaveBeenCalledWith(1);
});
it("keeps ordinary history's existing bound and never filters it to the target", async () => {
  await listRelationshipMessages("org", "person");
  expect(mock.limit).toHaveBeenCalledWith(200);
  expect(mock.eq).not.toHaveBeenCalledWith("id", expect.anything());
});
it("maps the target and keeps an inaccessible or absent target empty", async () => {
  expect(await getRelationshipMessage("org", "person", "target")).toBeNull();
  mock.result.data = [
    {
      id: "target",
      organization_id: "org",
      relationship_id: "person",
      direction: "inbound",
      occurred_at: "2026-11-04T10:00:00Z",
      body_text: "Stored text",
    },
  ];
  expect(await getRelationshipMessage("org", "person", "target")).toMatchObject({
    id: "target",
    bodyText: "Stored text",
    relationshipId: "person",
  });
});
it("propagates failed reads instead of reporting a missing target", async () => {
  mock.result.error = { message: "Read unavailable" };
  await expect(getRelationshipMessage("org", "person", "target")).rejects.toThrow(
    "Read unavailable",
  );
});
