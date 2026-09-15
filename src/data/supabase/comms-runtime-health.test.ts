import { describe, expect, it, vi } from "vitest";

/**
 * Three independent reads, three independent truths. A success older than the
 * most recent page must still be found, and a failed read must never become a
 * claim that nothing succeeded.
 */

interface Result {
  data?: unknown;
  count?: number;
  error?: { message: string } | null;
}

const results: Result[] = [];
const selects: { columns: string; options?: unknown }[] = [];

function builder(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ["eq", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain["then"] = (resolve: (value: Result) => unknown) =>
    Promise.resolve({ error: null, ...result }).then(resolve);
  return chain;
}

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: () => ({
      select: (columns: string, options?: unknown) => {
        selects.push({ columns, ...(options ? { options } : {}) });
        return builder(results[selects.length - 1] ?? {});
      },
    }),
  },
}));

const { reviewRunHealth } = await import("./comms-runtime-health");

function queue(...items: Result[]) {
  results.length = 0;
  selects.length = 0;
  results.push(...items);
}

describe("reviewRunHealth", () => {
  it("counts every run and finds a success older than the recent page", async () => {
    queue(
      { count: 312 },
      { data: [{ id: "old-success" }] },
      {
        data: [
          {
            status: "failed",
            error_code: "provider_call_failed",
            started_at: "2026-09-14T00:00:00.000Z",
          },
        ],
      },
    );

    const health = await reviewRunHealth("org-1");
    expect(health.total).toBe(312);
    expect(health.everSucceeded).toBe(true);
    expect(health.lastStatus).toBe("failed");
    expect(health.lastErrorCode).toBe("provider_call_failed");
    // The count is asked for exactly, not inferred from a page of rows.
    expect(selects[0]?.options).toEqual({ count: "exact", head: true });
  });

  it("says nothing ever completed only when the whole table was checked", async () => {
    queue({ count: 1 }, { data: [] }, { data: [{ status: "failed", started_at: "x" }] });
    const health = await reviewRunHealth("org-1");
    expect(health.everSucceeded).toBe(false);
  });

  it("reports a failed read as unknown, never as zero or never-succeeded", async () => {
    queue(
      { error: { message: "count read failed" } },
      { error: { message: "success read failed" } },
      { data: [{ status: "complete", started_at: "y" }] },
    );

    const health = await reviewRunHealth("org-1");
    expect(health.total).toBeNull();
    expect(health.totalError).toBe("count read failed");
    expect(health.everSucceeded).toBeNull();
    expect(health.successError).toBe("success read failed");
    // The read that worked still reports its fact.
    expect(health.lastStatus).toBe("complete");
  });
});
