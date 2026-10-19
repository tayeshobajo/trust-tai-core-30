import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stewardUpdates, type StewardUpdateInput } from "./steward-updates";
const org = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222",
  task = "33333333-3333-4333-8333-333333333333",
  meeting = "44444444-4444-4444-8444-444444444444";
const input: StewardUpdateInput = {
  organizationId: org,
  taskId: task,
  kind: "commitment",
  meetingId: meeting,
  operationId: "55555555-5555-4555-8555-555555555555",
  note: "A recorded decision.",
  authorName: "Test",
  laterMeetingId: null,
  laterDate: null,
  originalDue: "2026-10-01",
  action: "update",
};
function fixture(
  options: {
    role?: string;
    owner?: string;
    denied?: boolean;
    private?: boolean;
    error?: boolean;
  } = {},
) {
  const writes: Record<string, unknown>[] = [];
  const stored = new Map<string, Record<string, unknown>>();
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    from: (table: string) => {
      let body: Record<string, unknown> | undefined;
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return query;
        },
        in: () => query,
        order: () => query,
        limit: () => query,
        insert: (value: Record<string, unknown>) => {
          body = value;
          return query;
        },
        single: async () => {
          if (table === "commitments" || table === "steward_tasks")
            return options.denied || options.private
              ? { data: null, error: { message: "Denied" } }
              : {
                  data: {
                    id: task,
                    conversation_id: meeting,
                    owner_user_id: options.owner ?? actor,
                    task_visibility: "business",
                  },
                  error: null,
                };
          if (table === "organization_memberships")
            return { data: { role: options.role ?? "member" }, error: null };
          if (body) {
            writes.push(body);
            if (options.error) return { data: null, error: { message: "Write failed" } };
            const key = String(body["source_event_key"]);
            if (stored.has(key)) return { data: null, error: { code: "23505" } };
            stored.set(key, body);
            return { data: { id: "saved" }, error: null };
          }
          return { data: stored.get(String(filters["source_event_key"])), error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { service: stewardUpdates(client), writes, stored };
}
describe("strict task update persistence boundary", () => {
  it("records authenticated authorship, original source, date and stable task identity", async () => {
    const f = fixture();
    await f.service.post({ ...input, action: "roll_forward", laterDate: "2099-01-01" });
    expect(f.writes[0]).toMatchObject({
      actor_user_id: actor,
      entity_id: task,
      payload: {
        original_meeting_id: meeting,
        original_due: "2026-10-01",
        later_date: "2099-01-01",
      },
    });
    expect(f.writes[0]).not.toHaveProperty("status");
  });
  it("replays the same operation without a duplicate event", async () => {
    const f = fixture();
    await f.service.post(input);
    await f.service.post(input);
    expect(f.stored.size).toBe(1);
  });
  it("rejects a changed retry payload", async () => {
    const f = fixture();
    await f.service.post(input);
    await expect(f.service.post({ ...input, note: "Different text" })).rejects.toThrow(
      "already been used",
    );
  });
  it.each([{ role: "viewer" }, { owner: "other" }, { denied: true }, { private: true }])(
    "refuses inaccessible or unauthorized work %j",
    async (options) => {
      const f = fixture(options);
      await expect(f.service.post(input)).rejects.toThrow();
      expect(f.writes).toHaveLength(0);
    },
  );
  it("does not invent persistence after a failed write", async () => {
    const f = fixture({ error: true });
    await expect(f.service.post(input)).rejects.toThrow("Write failed");
    expect(f.stored.size).toBe(0);
  });
  it("rejects a past roll-forward date and wrong original meeting", async () => {
    const f = fixture();
    await expect(
      f.service.post({ ...input, action: "roll_forward", laterDate: "2020-01-01" }),
    ).rejects.toThrow("future");
    await expect(f.service.post({ ...input, meetingId: org })).rejects.toThrow("original meeting");
    expect(f.writes).toHaveLength(0);
  });
});
