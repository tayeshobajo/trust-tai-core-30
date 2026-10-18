import { describe, it, expect } from "vitest";
import { boardService, businessWorkQuery, cmdTasks } from "./cmd-tasks";
import { vi } from "vitest";
import { withMeetingAssociation } from "@/domain/steward-meeting-links";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardEdit, BoardTask } from "@/domain/cmd-tasks";
const org = "00000000-0000-4000-8000-000000000010";
const owner = "00000000-0000-4000-8000-000000000001";
const edit: BoardEdit = {
  title: "Synthetic task",
  status: "open",
  next_action: "Check persistence",
  blocked_because: "",
  depends_on_task_id: null,
  parent_task_id: null,
  notes: null,
  due_at: null,
  owner_user_id: owner,
  completion_evidence: "",
  acceptance_criteria: [],
  context_links: [],
};
type MockError = { code?: string; message: string };
type MockResult = { data: BoardTask | BoardTask[] | null; error: MockError | null };
type MockQuery = PromiseLike<MockResult> & {
  select: () => MockQuery;
  eq: (key: string, value: unknown) => MockQuery;
  order: () => MockQuery;
  limit: (count: number) => MockQuery;
  insert: (patch: Partial<BoardTask>) => MockQuery;
  update: (patch: Partial<BoardTask>) => MockQuery;
  single: () => Promise<MockResult>;
  maybeSingle: () => Promise<MockResult>;
};
/** Stateful mocked transport. It intentionally does NOT simulate or prove RLS. */
function transport() {
  const rows: BoardTask[] = [];
  const operations: string[] = [];
  let issue: MockError | null = null;
  const client = {
    from: () => {
      let op = "read";
      let patch: Partial<BoardTask> = {};
      const filters: [string, unknown][] = [];
      let cap = 1001;
      async function execute(single = false): Promise<MockResult> {
        operations.push(op);
        if (issue) return { data: null, error: issue };
        if (op === "insert") {
          if (
            rows.some(
              (r) =>
                r.organization_id === patch.organization_id &&
                r.correlation_id === patch.correlation_id,
            )
          )
            return { data: null, error: { code: "23505", message: "duplicate" } };
          const row = {
            ...patch,
            id: "00000000-0000-4000-8000-000000000020",
            owner_label: "Test owner",
            created_by: owner,
            completed_at: null,
            completed_by: null,
            archived_at: null,
            updated_at: "2026-10-04T00:00:00Z",
            revision: 0,
          } as BoardTask;
          rows.push(row);
          return { data: row, error: null };
        }
        const matches = rows.filter((row) =>
          filters.every(([key, value]) => row[key as keyof BoardTask] === value),
        );
        if (op === "update")
          matches.forEach((row) => Object.assign(row, patch, { revision: row.revision + 1 }));
        return { data: single ? (matches[0] ?? null) : matches.slice(0, cap), error: null };
      }
      const q: MockQuery = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          cap = n;
          return q;
        },
        insert: (v: Partial<BoardTask>) => {
          op = "insert";
          patch = v;
          return q;
        },
        update: (v: Partial<BoardTask>) => {
          op = "update";
          patch = v;
          return q;
        },
        single: () => execute(true),
        maybeSingle: () => execute(true),
        then: (resolve, reject) => execute().then(resolve, reject),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, rows, operations, fail: (value: MockError) => (issue = value) };
}
describe("board service mocked transport", () => {
  it("reads only business work with org+user-specific cache identity", async () => {
    const db = transport();
    const service = boardService(db.client);
    await service.create(org, "personal", "private", edit);
    expect((await service.list(org, "business")).tasks).toHaveLength(0);
    const read = vi.spyOn(cmdTasks, "list").mockResolvedValue({ tasks: [], truncated: false });
    const query = businessWorkQuery(org, owner);
    expect(query.queryKey).toEqual(["cmd-tasks", org, owner, "business"]);
    expect(businessWorkQuery(org, "other").queryKey).not.toEqual(query.queryKey);
    expect(businessWorkQuery("other-org", owner).queryKey).not.toEqual(query.queryKey);
    await query.queryFn();
    expect(read).toHaveBeenCalledWith(org, "business");
    read.mockRestore();
  });
  it("links/removes by revision-checked update without creating or resetting work", async () => {
    const db = transport();
    const service = boardService(db.client);
    const created = await service.create(org, "business", "link-test", { ...edit, notes: "Keep notes", context_links: [{ label: "Email", url: "https://example.com/email", kind: "email" }] });
    const linked = await service.update(created, { ...edit, notes: created.notes, context_links: withMeetingAssociation(created.context_links, owner) });
    expect(linked.id).toBe(created.id);
    expect(linked.revision).toBe(1);
    await expect(service.update(created, { ...edit, context_links: [] })).rejects.toThrow(/changed/);
    expect(db.rows).toHaveLength(1);
    const removed = await service.update(linked, { ...edit, notes: linked.notes, context_links: withMeetingAssociation(linked.context_links, null) });
    expect(removed.context_links).toEqual([{ label: "Email", url: "https://example.com/email", kind: "email" }]);
    expect(removed.notes).toBe("Keep notes");
    expect(db.operations.filter((op) => op === "insert")).toHaveLength(1);
  });
  it("creates once using stable retry identity and rereads through a fresh service", async () => {
    const db = transport();
    const service = boardService(db.client);
    const created = await service.create(org, "business", "test:stable", edit);
    const retry = await service.create(org, "business", "test:stable", edit);
    expect(retry.id).toBe(created.id);
    expect(db.rows).toHaveLength(1);
    expect((await boardService(db.client).list(org, "business")).tasks[0]?.next_action).toBe(
      "Check persistence",
    );
  });
  it("refuses stale writes and preserves persisted state", async () => {
    const db = transport();
    const service = boardService(db.client);
    const created = await service.create(org, "business", "test:stable", edit);
    await service.update(created, {
      ...edit,
      status: "blocked",
      blocked_because: "Test access missing",
    });
    await expect(service.update(created, { ...edit, title: "Stale overwrite" })).rejects.toThrow(
      /changed/,
    );
    expect((await service.list(org, "business")).tasks[0]?.status).toBe("blocked");
  });
  it("archives and restores without a delete operation", async () => {
    const db = transport();
    const service = boardService(db.client);
    const created = await service.create(org, "personal", "test:stable", edit);
    await service.archive(created, true);
    const archived = (await service.list(org, "personal")).tasks[0]!;
    expect(archived.archived_at).not.toBeNull();
    await service.archive(archived, false);
    expect((await service.list(org, "personal")).tasks[0]?.archived_at).toBeNull();
    expect(db.operations).not.toContain("delete");
  });
  it("does not report a failed read as an empty list", async () => {
    const db = transport();
    db.fail({ code: "42703", message: "missing column" });
    await expect(boardService(db.client).list(org, "business")).rejects.toThrow(
      /approved database update/,
    );
  });
  it("does not transport invalid state or visibility mutations", async () => {
    const db = transport();
    const service = boardService(db.client);
    await expect(
      service.create(org, "business", "test:stable", { ...edit, status: "complete" }),
    ).rejects.toThrow();
    expect(db.operations).toHaveLength(0);
  });
});
