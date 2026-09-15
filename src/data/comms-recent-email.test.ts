/**
 * The Dashboard's recent-email read, pinned.
 *
 * Synthetic fixtures only, against a stub of the Supabase query builder. What
 * matters here is the shape of the read: the organization and the window are
 * applied before any paging, the order is newest first, the total is the
 * database's own count, and a failure is unavailable rather than empty.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Record<string, unknown>[] = [];
let response: { data: unknown[] | null; error: { message: string } | null; count: number | null } = {
  data: [],
  error: null,
  count: 0,
};

vi.mock("@/integrations/trust-tai/supabase", () => {
  function builder(record: Record<string, unknown>) {
    const chain = {
      select(columns: string, options?: { count?: string }) {
        record["columns"] = columns;
        record["count"] = options?.count;
        return chain;
      },
      eq(column: string, value: unknown) {
        record[`eq:${column}`] = value;
        record["order:eq"] = (record["order:eq"] as string[] | undefined)?.concat(column) ?? [column];
        return chain;
      },
      gte(column: string, value: unknown) {
        record[`gte:${column}`] = value;
        return chain;
      },
      order(column: string, options: { ascending: boolean }) {
        record["orderBy"] = column;
        record["ascending"] = options.ascending;
        return chain;
      },
      range(from: number, to: number) {
        record["range"] = [from, to];
        return Promise.resolve(response);
      },
    };
    return chain;
  }

  return {
    supabase: {
      from(table: string) {
        const record: Record<string, unknown> = { table };
        calls.push(record);
        return builder(record);
      },
    },
  };
});

const { listRecentEmail, RecentEmailUnavailable } = await import("@/data/comms-recent-email");

function row(id: string, occurredAt: string, organizationId = "org-1") {
  return {
    id,
    organization_id: organizationId,
    relationship_id: "rel-1",
    thread_id: null,
    provider_message_id: `p-${id}`,
    provider_thread_id: "t-1",
    direction: "inbound",
    from_email: "dana@northwind.test",
    from_name: "Dana Wright",
    subject: "Two questions",
    snippet: "…",
    occurred_at: occurredAt,
    provenance: { source: "gmail", mailbox: "tai@trust-tai.com" },
  };
}

describe("listRecentEmail", () => {
  beforeEach(() => {
    calls.length = 0;
    response = { data: [], error: null, count: 0 };
  });

  it("scopes to the organization and the window before paging, newest first", async () => {
    response = {
      data: [row("a", "2026-09-12T09:00:00.000Z"), row("b", "2026-09-11T09:00:00.000Z")],
      error: null,
      count: 57,
    };

    const read = await listRecentEmail("org-1", {
      limit: 10,
      now: new Date("2026-09-15T00:00:00.000Z"),
    });

    const call = calls[0]!;
    expect(call["table"]).toBe("comms_messages");
    expect(call["eq:organization_id"]).toBe("org-1");
    expect(call["gte:occurred_at"]).toBe("2026-08-16T00:00:00.000Z");
    expect(call["orderBy"]).toBe("occurred_at");
    expect(call["ascending"]).toBe(false);
    expect(call["range"]).toEqual([0, 9]);
    expect(call["count"]).toBe("exact");

    // The total is the database's count of the window, not the page length.
    expect(read.total).toBe(57);
    expect(read.messages.map((message) => message.id)).toEqual(["a", "b"]);
    expect(read.messages[0]!.mailbox).toBe("tai@trust-tai.com");
  });

  it("reports a failed read as unavailable rather than an empty inbox", async () => {
    response = { data: null, error: { message: "permission denied" }, count: null };

    await expect(listRecentEmail("org-1")).rejects.toBeInstanceOf(RecentEmailUnavailable);
  });

  it("reports a missing message store as unavailable", async () => {
    response = {
      data: null,
      error: { message: 'relation "public.comms_messages" does not exist' },
      count: null,
    };

    await expect(listRecentEmail("org-1")).rejects.toThrow(/not available/i);
  });

  it("sheds a column an older schema does not have and retries once", async () => {
    let first = true;
    const original = response;
    void original;
    const stub = {
      data: [row("a", "2026-09-12T09:00:00.000Z")],
      error: null,
      count: 1,
    };

    // The first attempt fails naming body_text; the second must succeed.
    Object.defineProperty(globalThis, "__unused", { value: 0, configurable: true });
    response = { data: null, error: { message: "column comms_messages.body_text" }, count: null };
    const promise = listRecentEmail("org-1", { limit: 5 }).then((read) => {
      expect(read.messages).toHaveLength(1);
      return read;
    });
    // Swap in the success for the retry.
    queueMicrotask(() => {
      if (first) {
        first = false;
        response = stub;
      }
    });
    await promise;
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[1]!["columns"]).not.toContain("body_text");
  });
});
