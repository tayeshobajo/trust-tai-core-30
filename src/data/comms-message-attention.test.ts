import { beforeEach, expect, it, vi } from "vitest";
const { from, pages, calls } = vi.hoisted(() => ({
  from: vi.fn(),
  pages: [] as unknown[],
  calls: [] as unknown[][],
}));
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: { from } }));
import { listMessageAttention } from "./comms-message-attention";
beforeEach(() => {
  pages.length = 0;
  calls.length = 0;
  from.mockImplementation((table: string) => {
    const q: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ["select", "eq", "order"])
      q[name] = (...args: unknown[]) => {
        calls.push([table, name, ...args]);
        return q;
      };
    q["range"] = (...[start, end]: unknown[]) => {
      calls.push(["range", start, end]);
      return Promise.resolve(pages.shift());
    };
    return q;
  });
});
const row = {
  id: "m",
  organization_id: "o",
  relationship_id: "r",
  direction: "inbound",
  occurred_at: "2026-11-04",
};
it("reads scoped metadata and pages beyond the provider default", async () => {
  pages.push(
    {
      data: Array.from({ length: 500 }, (_, i) => ({ ...row, id: String(i) })),
      count: 501,
      error: null,
    },
    { data: [row], count: 501, error: null },
  );
  expect(await listMessageAttention("o")).toHaveLength(501);
  expect(calls).toContainEqual(["comms_messages", "eq", "organization_id", "o"]);
  expect(calls).toContainEqual(["range", 500, 999]);
  expect(calls[0]?.[2]).not.toContain("body_text");
});
it("rejects a later-page failure instead of returning partial success", async () => {
  pages.push(
    {
      data: Array.from({ length: 500 }, (_, i) => ({ ...row, id: String(i) })),
      count: 501,
      error: null,
    },
    { error: { message: "unavailable" } },
  );
  await expect(listMessageAttention("o")).rejects.toThrow("unavailable");
});
it("rejects unknown coverage and short pages", async () => {
  pages.push({ data: [], count: null, error: null });
  await expect(listMessageAttention("o")).rejects.toThrow("coverage");
  pages.push({ data: [row], count: 2, error: null });
  await expect(listMessageAttention("o")).rejects.toThrow("incomplete");
});
it("allows a confirmed empty store", async () => {
  pages.push({ data: [], count: 0, error: null });
  expect(await listMessageAttention("o")).toEqual([]);
});
