import { describe, it, expect } from "vitest";
import { BoardEditSchema, mayEditBoardTask, type BoardTask, type BoardEdit } from "./cmd-tasks";
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const task = { task_visibility: "business", created_by: owner, owner_user_id: other } as BoardTask;
const edit: BoardEdit = {
  title: "Verify the result",
  status: "open",
  next_action: "Run the check",
  blocked_because: "",
  depends_on_task_id: null,
  parent_task_id: null,
  notes: null,
  due_at: null,
  owner_user_id: null,
  completion_evidence: "",
  acceptance_criteria: [],
  context_links: [],
};
describe("board application contract (not database RLS proof)", () => {
  it("allows creator, assignee and business admin but not unrelated members or viewers", () => {
    expect(mayEditBoardTask(task, { userId: owner, role: "member" })).toBe(true);
    expect(mayEditBoardTask(task, { userId: other, role: "member" })).toBe(true);
    expect(mayEditBoardTask(task, { userId: "admin", role: "admin" })).toBe(true);
    expect(mayEditBoardTask(task, { userId: "stranger", role: "member" })).toBe(false);
    expect(mayEditBoardTask(task, { userId: owner, role: "viewer" })).toBe(false);
  });
  it("does not let a business admin edit another person’s private task", () => {
    expect(
      mayEditBoardTask({ ...task, task_visibility: "personal" }, { userId: owner, role: "admin" }),
    ).toBe(false);
    expect(
      mayEditBoardTask({ ...task, task_visibility: "personal" }, { userId: other, role: "member" }),
    ).toBe(true);
  });
  it("requires a blocker and a checked completion result", () => {
    expect(BoardEditSchema.safeParse({ ...edit, status: "blocked" }).success).toBe(false);
    expect(
      BoardEditSchema.safeParse({
        ...edit,
        status: "blocked",
        blocked_because: "Test access pending",
      }).success,
    ).toBe(true);
    expect(BoardEditSchema.safeParse({ ...edit, status: "complete" }).success).toBe(false);
    expect(
      BoardEditSchema.safeParse({
        ...edit,
        status: "complete",
        completion_evidence: "Verified refresh persistence in isolated test.",
      }).success,
    ).toBe(true);
  });
  it("rejects classification, creator, receipt timestamp and revision injection", () => {
    for (const patch of [
      { task_visibility: "business" },
      { created_by: owner },
      { completed_at: "2026-10-04T00:00:00Z" },
      { revision: 99 },
    ])
      expect(BoardEditSchema.safeParse({ ...edit, ...patch }).success).toBe(false);
  });
  it("rejects active URLs and invalid dates without fabricating values", () => {
    expect(
      BoardEditSchema.safeParse({
        ...edit,
        context_links: [{ label: "bad", url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
    expect(BoardEditSchema.safeParse({ ...edit, due_at: "not-a-date" }).success).toBe(false);
    expect(BoardEditSchema.parse(edit).due_at).toBeNull();
  });
});
