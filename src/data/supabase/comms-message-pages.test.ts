import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  filters: [] as unknown[][],
  orders: [] as unknown[][],
  or: [] as string[],
  error: null as null | { message: string },
}));
vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: () => {
      let limit = 51;
      let predicate = "";
      const q = {
        select: () => q,
        eq: (...args: unknown[]) => {
          mock.filters.push(args);
          return q;
        },
        order: (...args: unknown[]) => {
          mock.orders.push(args);
          return q;
        },
        limit: (n: number) => {
          limit = n;
          return q;
        },
        or: (s: string) => {
          predicate = s;
          mock.or.push(s);
          return q;
        },
        then: (resolve: (r: unknown) => unknown) => {
          let rows = [...mock.rows].sort(
            (a, b) =>
              String(b["occurred_at"]).localeCompare(String(a["occurred_at"])) ||
              String(b["id"]).localeCompare(String(a["id"])),
          );
          if (predicate) {
            const found = predicate.match(
              /^occurred_at.lt.(.*),and\(occurred_at.eq.(.*),id.lt.(.*)\)$/,
            )!;
            rows = rows.filter(
              (r) =>
                String(r["occurred_at"]) < found[1]! ||
                (r["occurred_at"] === found[2] && String(r["id"]) < found[3]!),
            );
          }
          return Promise.resolve({ data: rows.slice(0, limit), error: mock.error }).then(resolve);
        },
      };
      return q;
    },
  },
}));
import { listRelationshipMessagePage, listRelationshipMessages } from "./comms-messages";
const id = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
beforeEach(() => {
  mock.rows = [];
  mock.filters = [];
  mock.orders = [];
  mock.or = [];
  mock.error = null;
});
it("loads recent 50 first then every older row exactly once despite a new arrival and timestamp ties", async () => {
  mock.rows = Array.from({ length: 225 }, (_, i) => ({
    id: id(i),
    organization_id: "org",
    relationship_id: "rel",
    direction: "inbound",
    occurred_at: "2026-11-05T00:00:00.123456Z",
  }));
  let page = await listRelationshipMessagePage("org", "rel");
  expect(page.messages.at(-1)?.id).toBe(id(224));
  expect(page.messages[0]?.id).toBe(id(175));
  const seen = page.messages.map((m) => m.id);
  mock.rows.push({ id: id(999), occurred_at: "2026-11-06T00:00:00Z" });
  while (page.next) {
    page = await listRelationshipMessagePage("org", "rel", page.next);
    seen.push(...page.messages.map((m) => m.id));
  }
  expect(seen).toHaveLength(225);
  expect(new Set(seen).size).toBe(225);
  expect(seen).not.toContain(id(999));
  expect(mock.or[0]).toContain(".123456Z");
  expect(mock.filters).toContainEqual(["organization_id", "org"]);
  expect(mock.filters).toContainEqual(["relationship_id", "rel"]);
  expect(mock.orders).toContainEqual(["id", { ascending: false }]);
});
it("legacy bounded readers return newest records in chronological display order", async () => {
  mock.rows = Array.from({ length: 225 }, (_, i) => ({
    id: id(i),
    occurred_at: "2026-11-05T00:00:00Z",
  }));
  const rows = await listRelationshipMessages("org", "rel");
  expect(rows).toHaveLength(200);
  expect(rows[0]?.id).toBe(id(25));
  expect(rows.at(-1)?.id).toBe(id(224));
});
it("rejects cursor injection and propagates unavailable history", async () => {
  await expect(
    listRelationshipMessagePage("org", "rel", {
      id: "x),organization_id.neq.org",
      occurredAt: "2026-11-05",
    }),
  ).rejects.toThrow("Invalid history cursor");
  mock.error = { message: "permission denied" };
  await expect(listRelationshipMessagePage("org", "rel")).rejects.toThrow("permission denied");
});
