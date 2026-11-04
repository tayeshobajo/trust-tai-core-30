import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceRelationshipSummary } from "./comms-sync-summary.server";
function fixture(fail = false) {
  const writes: { payload: Record<string, unknown>; scope: string[][]; filter?: string }[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("comms_relationships");
      return {
        update(payload: Record<string, unknown>) {
          const write = { payload, scope: [] as string[][], filter: "" };
          writes.push(write);
          const q = {
            eq(key: string, value: string) {
              write.scope.push([key, value]);
              return q;
            },
            is(key: string, value: null) {
              expect(value).toBeNull();
              return q.or(`${key}.is.null`);
            },
            or(filter: string) {
              write.filter = filter;
              return Promise.resolve({ error: fail ? { message: "write failed" } : null });
            },
          };
          return q;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, writes };
}
describe("conservative sync summaries", () => {
  it("uses atomic monotonic filters and organization scope", async () => {
    const { client, writes } = fixture();
    await advanceRelationshipSummary(client, "o", "r", "2026-11-04", "2026-11-05");
    expect(writes[0]!.filter).toBe(
      "last_touch_at.is.null,last_touch_at.lt.2026-11-04T00:00:00.000Z",
    );
    expect(writes[1]!.filter).toBe("response_due_at.is.null");
    for (const write of writes)
      expect(write.scope).toEqual([
        ["organization_id", "o"],
        ["id", "r"],
      ]);
  });
  it("never clears a due date on outbound-only or empty batches", async () => {
    const { client, writes } = fixture();
    await advanceRelationshipSummary(client, "o", "r", "2026-11-04");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.payload).not.toHaveProperty("response_due_at");
    await advanceRelationshipSummary(client, "o", "r");
    await advanceRelationshipSummary(client, "o", "r", "invalid", "invalid");
    expect(writes).toHaveLength(1);
  });
  it("propagates write errors", async () => {
    const { client } = fixture(true);
    await expect(advanceRelationshipSummary(client, "o", "r", "2026-11-04")).rejects.toThrow(
      "write failed",
    );
  });
});
