/**
 * Selected-task and meeting verification truth come ONLY from the 007
 * projection RPC; history is a bounded, disclosed display read.
 */
import { describe, expect, it, vi } from "vitest";
import {
  foldVerificationProjection,
  readSelectedTaskVerification,
  readTaskVerificationHistory,
  type MeetingVerificationProjectionRow,
} from "./steward-verification.supabase";

const T1 = "10000000-0000-0000-0000-000000000001";
const T2 = "10000000-0000-0000-0000-000000000002";

function row(over: Partial<MeetingVerificationProjectionRow>): MeetingVerificationProjectionRow {
  return {
    task_id: T1,
    status: "complete",
    revision: 5,
    latest_kind: "verify",
    latest_revision_after: 5,
    verified: true,
    missing: [],
    ...over,
  };
}

function receiptRow(i: number) {
  return {
    id: `r-${String(i).padStart(4, "0")}`,
    organization_id: "o1",
    task_id: T1,
    operation_id: `op-${i}`,
    kind: i % 2 ? "verify" : "reopen",
    note: `receipt ${i}`,
    actor_id: "u1",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    task_revision_after: i,
  };
}

/** Fake client: rpc returns the projection; from() records the history query. */
function fakeClient(opts: {
  rpc: { data: unknown; error: unknown };
  history?: { data: unknown; error: unknown };
}) {
  const historyCalls: { order: [string, boolean][]; limit: number | null } = {
    order: [],
    limit: null,
  };
  const client = {
    rpc: vi.fn(async () => opts.rpc),
    from: vi.fn(() => {
      const q = {
        select: () => q,
        eq: () => q,
        order: (col: string, o: { ascending: boolean }) => {
          historyCalls.order.push([col, o.ascending]);
          return q;
        },
        limit: async (n: number) => {
          historyCalls.limit = n;
          return opts.history ?? { data: [], error: null };
        },
      };
      return q;
    }),
  };
  return { client, historyCalls };
}

describe("foldVerificationProjection", () => {
  it("zero visible rows: every requested id is unknown, never false", () => {
    const folded = foldVerificationProjection([T1, T2], []);
    expect(folded.verified).toEqual({});
    expect(folded.unknown.sort()).toEqual([T1, T2].sort());
  });

  it("requested minus returned is unknown; returned rows keep their explicit boolean", () => {
    const folded = foldVerificationProjection([T1, T2], [row({ verified: false })]);
    expect(folded.verified).toEqual({ [T1]: false });
    expect(folded.unknown).toEqual([T2]);
  });

  it("a row for an id that was not requested is ignored", () => {
    const folded = foldVerificationProjection([T2], [row({})]);
    expect(folded.verified).toEqual({});
    expect(folded.unknown).toEqual([T2]);
  });
});

describe("readSelectedTaskVerification", () => {
  it("verified and revision come from the projection even when history shows an older verify", async () => {
    const { client } = fakeClient({
      rpc: { data: [row({ verified: false, latest_kind: "reopen", revision: 8 })], error: null },
      history: { data: [receiptRow(1)], error: null },
    });
    const read = await readSelectedTaskVerification(client, "o1", T1);
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") return;
    expect(read.read.verified).toBe(false);
    expect(read.read.task.revision).toBe(8);
  });

  it("missing / personal / inaccessible task (no projection row) is rejected, not inferred from history", async () => {
    const { client } = fakeClient({
      rpc: { data: [], error: null },
      history: { data: [receiptRow(1)], error: null },
    });
    const read = await readSelectedTaskVerification(client, "o1", T1);
    expect(read.kind).toBe("rejected");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("a projection error is rejected", async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { message: "x" } } });
    expect((await readSelectedTaskVerification(client, "o1", T1)).kind).toBe("rejected");
  });

  it("calls the projection RPC with exactly the one selected id", async () => {
    const { client } = fakeClient({ rpc: { data: [row({})], error: null } });
    await readSelectedTaskVerification(client, "o1", T1);
    expect(client.rpc).toHaveBeenCalledWith("steward_meeting_verification_projection", {
      p_org: "o1",
      p_task_ids: [T1],
    });
  });
});

describe("readTaskVerificationHistory", () => {
  it("queries newest first with LIMIT 101, trims to 100, discloses truncation, returns chronological", async () => {
    // The DB returns newest first: ids 1200 down to 1100 (101 rows).
    const newestFirst = Array.from({ length: 101 }, (_, k) => receiptRow(1200 - k));
    const { client, historyCalls } = fakeClient({
      rpc: { data: [], error: null },
      history: { data: newestFirst, error: null },
    });
    const history = await readTaskVerificationHistory(client, "o1", T1);
    expect(historyCalls.order).toEqual([
      ["created_at", false],
      ["id", false],
    ]);
    expect(historyCalls.limit).toBe(101);
    expect(history.truncated).toBe(true);
    expect(history.receipts).toHaveLength(100);
    expect(history.receipts[0]!.note).toBe("receipt 1101");
    expect(history.receipts.at(-1)!.note).toBe("receipt 1200");
  });

  it("exactly 100 rows is not truncated", async () => {
    const rows = Array.from({ length: 100 }, (_, k) => receiptRow(100 - k));
    const { client } = fakeClient({
      rpc: { data: [], error: null },
      history: { data: rows, error: null },
    });
    const history = await readTaskVerificationHistory(client, "o1", T1);
    expect(history.truncated).toBe(false);
    expect(history.receipts).toHaveLength(100);
  });
});
