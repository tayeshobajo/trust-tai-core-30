import { describe, it, expect, vi } from "vitest";
const mocked = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: () => {
      const q = {
        select: (): unknown => q,
        eq: (): unknown => q,
        order: (): unknown => q,
        limit: async () => ({ data: mocked.rows, error: null }),
      };
      return q;
    },
  },
}));
import { stewardTasks } from "./steward-tasks";
describe("classified task isolation from legacy activity writers", () => {
  it("retains historical rows but keeps classified titles out of legacy Steward actions", async () => {
    const base = {
      organization_id: "org",
      created_at: "2026-10-04T00:00:00Z",
      updated_at: "2026-10-04T00:00:00Z",
    };
    mocked.rows = [
      { ...base, id: "old", title: "Historical shared work" },
      { ...base, id: "legacy", title: "Explicit legacy", task_visibility: "legacy_shared" },
      { ...base, id: "business", title: "New business work", task_visibility: "business" },
      { ...base, id: "personal", title: "Private synthetic title", task_visibility: "personal" },
    ];
    expect((await stewardTasks.list("org")).map((row) => row.id)).toEqual(["old", "legacy"]);
  });
});
