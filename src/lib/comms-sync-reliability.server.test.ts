import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fairThreadBatch,
  GoogleReadError,
  readAllSyncMetadata,
  retryAt,
  retryAfterAt,
  retryDue,
  revokedCredential,
} from "./comms-sync-reliability.server";
import { runSyncPass } from "./comms-gmail.server";
afterEach(() => vi.unstubAllGlobals());

it("rotates all 63 approved threads through bounded passes including wrap and deletion of cursor", () => {
  const ids = Array.from({ length: 63 }, (_, i) => `t${String(i).padStart(3, "0")}`);
  const seen = new Set<string>();
  let after: string | null = null;
  for (let i = 0; i < 3; i++) {
    const batch = fairThreadBatch(ids, after);
    batch.ids.forEach((id) => seen.add(id));
    after = batch.next;
    expect(batch.ids.length).toBeLessThanOrEqual(25);
  }
  expect(seen.size).toBe(63);
  expect(fairThreadBatch(["a", "c"], "b", 1).ids).toEqual(["c"]);
  expect(fairThreadBatch(["a", "c"], "z", 1).ids).toEqual(["a"]);
});
it("retries transient failures with capped backoff, never revoked/disconnected grants", () => {
  expect(revokedCredential(new GoogleReadError("expired", 400, "invalid_grant"))).toBe(true);
  expect(revokedCredential(new GoogleReadError("busy", 503))).toBe(false);
  expect(revokedCredential(new TypeError("network"))).toBe(false);
  expect(Date.parse(retryAt(1, 0))).toBe(300000);
  expect(Date.parse(retryAt(99, 0))).toBe(21600000);
  expect(retryDue("error", { retry: { next_at: retryAt(1, 0) } }, 0)).toBe(false);
  expect(retryDue("error", {}, 0)).toBe(true);
  expect(retryDue("revoked", {}, 0)).toBe(false);
  expect(retryDue("disconnected", {}, 0)).toBe(false);
});

function fakeClient(
  options: {
    metadataCount?: number;
    metadataError?: boolean;
    missingThread?: boolean;
    conflict?: boolean;
    labelMore?: boolean;
    unapprovedReply?: boolean;
    quotaLimited?: boolean;
  } = {},
) {
  const total = options.metadataCount ?? 40;
  const records = Array.from({ length: total }, (_, i) => ({
    id: String(i).padStart(6, "0"),
    provider_thread_id: `t${String(i).padStart(3, "0")}`,
    provenance: { mailbox: i === total - 1 ? "other@test.com" : "me@test.com" },
  }));
  const updates: Record<string, unknown>[] = [];
  const calls: { table: string; filters: unknown[][] }[] = [];
  const client = {
    from(table: string) {
      const filters: unknown[][] = [];
      calls.push({ table, filters });
      let after = "";
      let limit = 500;
      let update: Record<string, unknown> | null = null;
      let head = false;
      const q = {
        select: (_: string, opts?: { head?: boolean }) => {
          head = !!opts?.head;
          return q;
        },
        eq: (...args: unknown[]) => {
          filters.push(args);
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          limit = n;
          return q;
        },
        gt: (_: string, id: string) => {
          after = id;
          return q;
        },
        update: (value: Record<string, unknown>) => {
          update = value;
          updates.push(value);
          return q;
        },
        single: () =>
          Promise.resolve({
            data: {
              cursor: { keep: "preserved" },
              updated_at: "rev-1",
              last_sync_at: "previous-success",
            },
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({ data: { cursor: { keep: "preserved" } }, error: null }),
        then: (resolve: (result: unknown) => unknown) => {
          if (update)
            return Promise.resolve({
              data: options.conflict ? [] : [{ id: "integration" }],
              error: null,
            }).then(resolve);
          if (table === "comms_integrations")
            return Promise.resolve({ data: [], count: head ? 2 : null, error: null }).then(resolve);
          if (table === "comms_relationships")
            return Promise.resolve({
              data: options.unapprovedReply
                ? [{ id: "known", email: "client@test.com", full_name: "Known Client" }]
                : [],
              error: null,
            }).then(resolve);
          const rows = records.filter((row) => row.id > after);
          return Promise.resolve({
            data: rows.slice(0, limit),
            count: rows.length,
            error: options.metadataError ? { message: "offline" } : null,
          }).then(resolve);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const fetched: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url);
      if (url.endsWith("/labels"))
        return new Response(
          JSON.stringify({ labels: [{ id: "approved-label", name: "Trust Tai/Comms" }] }),
        );
      if (url.includes("/messages?"))
        return new Response(
          JSON.stringify({
            messages: options.labelMore
              ? Array.from({ length: 60 }, (_, i) => ({ id: `label-${i}` }))
              : [],
            ...(options.labelMore ? { nextPageToken: "more" } : {}),
          }),
        );
      if (options.quotaLimited)
        return new Response("rate limit", { status: 429, headers: { "Retry-After": "7200" } });
      if (options.missingThread) return new Response("temporarily unavailable", { status: 503 });
      return new Response(
        JSON.stringify({
          messages: options.unapprovedReply
            ? [
                {
                  id: "private-new",
                  threadId: "t001",
                  internalDate: "1793971200000",
                  labelIds: ["INBOX"],
                  payload: {
                    headers: [
                      { name: "From", value: "client@test.com" },
                      { name: "To", value: "me@test.com" },
                    ],
                  },
                },
              ]
            : [],
        }),
      );
    }),
  );
  return { client, updates, calls, fetched };
}
const input = {
  organizationId: "org",
  connection: { id: "integration", accountEmail: "me@test.com" },
  accessToken: "test-only",
  backfillDays: 2,
};

describe("real sync pass orchestration with mocked boundaries", () => {
  it("checks all metadata pages and reads only this mailbox's approved batch", async () => {
    const fake = fakeClient({ metadataCount: 1201 });
    const rows = await readAllSyncMetadata(fake.client, "comms_messages", "org");
    expect(rows).toHaveLength(1201);
    const result = await runSyncPass({ ...input, client: fake.client });
    expect(result.partial).toBe(true);
    expect(fake.fetched.filter((u) => u.includes("/threads/"))).toHaveLength(25);
    expect(fake.fetched.some((u) => u.includes("t1200"))).toBe(false);
    expect(
      fake.calls.every(
        (c) =>
          c.filters.some((f) => f[0] === "organization_id" && f[1] === "org") ||
          c.table === "comms_integrations",
      ),
    ).toBe(true);
    const final = fake.updates.at(-1)!;
    expect(final["cursor"]).toMatchObject({
      keep: "preserved",
      approved_rotation: { after: "t024" },
      last_run: {
        approved_threads_total: 1200,
        approved_threads_deferred: 1175,
        outcome: "partial",
      },
    });
    expect(final).not.toHaveProperty("last_sync_at");
  });
  it("never converts metadata read errors into a successful empty watch list", async () => {
    const fake = fakeClient({ metadataError: true });
    await expect(runSyncPass({ ...input, client: fake.client })).rejects.toThrow("read failed");
    expect(fake.updates).toHaveLength(0);
  });
  it("records thread failures as partial and preserves the previous success marker", async () => {
    const fake = fakeClient({ missingThread: true });
    const result = await runSyncPass({ ...input, client: fake.client });
    expect(result.partial).toBe(true);
    expect(result.lastSyncAt).toBe("previous-success");
    expect(fake.updates.at(-1)).not.toHaveProperty("last_sync_at");
    expect(fake.updates.at(-1)?.["cursor"]).toMatchObject({
      last_run: { outcome: "partial", approved_threads_unavailable: 25 },
    });
  });
  it("rejects a stale progress write instead of overwriting concurrent mailbox state", async () => {
    const fake = fakeClient({ conflict: true });
    await expect(runSyncPass({ ...input, client: fake.client })).rejects.toThrow(
      "progress not advanced",
    );
    expect(fake.calls.at(-1)?.filters).toContainEqual(["updated_at", "rev-1"]);
  });
});

it("marks capped labelled discovery partial without claiming a successful complete read", async () => {
  const fake = fakeClient({ labelMore: true });
  const result = await runSyncPass({ ...input, client: fake.client });
  expect(result.partial).toBe(true);
  expect(fake.updates.at(-1)?.["cursor"]).toMatchObject({
    last_run: { label_has_more: true, outcome: "partial" },
  });
  expect(fake.updates.at(-1)).not.toHaveProperty("last_sync_at");
});

it("does not store an unlabeled reply even in a known client's previously observed thread", async () => {
  const fake = fakeClient({ unapprovedReply: true });
  const result = await runSyncPass({ ...input, client: fake.client });
  expect(result.messagesStored).toBe(0);
  expect(result.messagesRead).toBe(0);
  expect(fake.fetched.some((url) => url.includes("/threads/"))).toBe(true);
  expect(fake.updates).toHaveLength(1); // integration status only, no relationship/thread changes
});

it("honors provider retry delay without reducing exponential backoff", () => {
  expect(retryAfterAt("7200", 0)).toBe("1970-01-01T02:00:00.000Z");
  expect(retryAfterAt("Thu, 01 Jan 1970 03:00:00 GMT", 0)).toBe("1970-01-01T03:00:00.000Z");
  expect(retryAfterAt("invalid", 0)).toBeUndefined();
  expect(retryAt(1, 0, retryAfterAt("7200", 0))).toBe("1970-01-01T02:00:00.000Z");
  expect(retryAt(1, 0, retryAfterAt("2", 0))).toBe("1970-01-01T00:05:00.000Z");
});
it("stops thread calls immediately on quota failure and does not advance the cursor", async () => {
  const fake = fakeClient({ quotaLimited: true });
  await expect(runSyncPass({ ...input, client: fake.client })).rejects.toMatchObject({
    status: 429,
  });
  expect(fake.fetched.filter((url) => url.includes("/threads/"))).toHaveLength(1);
  expect(fake.updates).toHaveLength(0);
});
