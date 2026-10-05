// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BusinessTaskBoard, TaskEditor } from "./business-task-board";
import type { BoardTask } from "@/domain/cmd-tasks";
import type { WorkspaceIdentity } from "@/lib/workspace";
import axe from "axe-core";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  personalCounts: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  importPlannedWork: vi.fn(),
}));
vi.mock("@/data/supabase/cmd-tasks", () => ({ cmdTasks: mocks }));
vi.mock("@/data/steward/task-choices", () => ({
  useTaskChoices: () => ({ data: { people: [] } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const owner = "00000000-0000-4000-8000-000000000001";
const identity = {
  userId: owner,
  organizationId: "00000000-0000-4000-8000-000000000010",
  name: "Test owner",
  role: "member",
} as WorkspaceIdentity;
const task: BoardTask = {
  id: "00000000-0000-4000-8000-000000000020",
  organization_id: identity.organizationId,
  created_by: owner,
  owner_user_id: owner,
  owner_label: "Test owner",
  title: "Synthetic business task",
  task_visibility: "business",
  status: "open",
  next_action: "Check refresh",
  blocked_because: "",
  depends_on_task_id: null,
  parent_task_id: null,
  completion_evidence: "",
  completed_at: null,
  completed_by: null,
  archived_at: null,
  due_at: null,
  updated_at: "2026-10-04T00:00:00Z",
  revision: 0,
  acceptance_criteria: ["Result persists"],
  context_links: [],
  notes: null,
  correlation_id: "synthetic:test",
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function board(viewer = identity) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BusinessTaskBoard identity={viewer} />
    </QueryClientProvider>,
  );
}
function editor(
  row: BoardTask = task,
  onSave = vi.fn().mockResolvedValue(undefined),
  viewer = identity,
) {
  render(
    <TaskEditor
      task={row}
      scope={row.task_visibility}
      identity={viewer}
      tasks={[row]}
      people={[]}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  return onSave;
}
describe("board UI with mocked transport", () => {
  it("adds the approved work only through the authenticated import action and reports failure", async () => {
    mocks.list.mockResolvedValue({ tasks: [], truncated: false });
    mocks.personalCounts.mockResolvedValue([]);
    mocks.importPlannedWork.mockRejectedValue(new Error("Import denied"));
    board({ ...identity, role: "admin", organizationSlug: "trust-tai" });
    fireEvent.click(await screen.findByRole("button", { name: "Add planned work" }));
    expect(await screen.findByText("Import denied")).toBeTruthy();
    expect(mocks.importPlannedWork).toHaveBeenCalledWith(identity.organizationId);
    expect(screen.queryByText("Approved business work added.")).toBeNull();
  });

  it("returns keyboard focus to the opening button after Escape", async () => {
    mocks.list.mockResolvedValue({ tasks: [], truncated: false });
    mocks.personalCounts.mockResolvedValue([]);
    board();
    await screen.findByText("No tasks in this view.");
    const trigger = screen.getByRole("button", { name: "New task" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Task title")));
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it("focuses the task title, closes with Escape and has no serious automated accessibility violations", async () => {
    const onClose = vi.fn();
    render(
      <TaskEditor
        task={task}
        scope="business"
        identity={identity}
        tasks={[task]}
        people={[]}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Task title")));
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
    ).toEqual([]);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("shows loading then an honest empty state", async () => {
    let resolve!: (value: { tasks: BoardTask[]; truncated: boolean }) => void;
    mocks.list.mockImplementation(() => new Promise((r) => (resolve = r)));
    mocks.personalCounts.mockResolvedValue([]);
    board();
    expect(screen.getByText("Loading tasks…")).toBeTruthy();
    resolve({ tasks: [], truncated: false });
    expect(await screen.findByText("No tasks in this view.")).toBeTruthy();
  });
  it("shows a read error and retry, not a false empty board", async () => {
    mocks.list.mockRejectedValue(new Error("Read unavailable"));
    mocks.personalCounts.mockResolvedValue([]);
    board();
    expect(await screen.findByText("Read unavailable")).toBeTruthy();
    expect(screen.queryByText("No tasks in this view.")).toBeNull();
    mocks.list.mockResolvedValue({ tasks: [], truncated: false });
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("No tasks in this view.")).toBeTruthy();
  });
  it("requires checked evidence and keeps a failed save open for recovery", async () => {
    const save = editor(task, vi.fn().mockRejectedValue(new Error("Revision conflict")));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "complete" } });
    fireEvent.change(screen.getByLabelText("Checked result and evidence"), {
      target: { value: "Checked persistence after refresh with fixture record." },
    });
    fireEvent.click(screen.getByText("Save task"));
    expect(
      await screen.findByText("Confirm that you checked the result before recording delivery."),
    ).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("I checked the result against the acceptance criteria."));
    fireEvent.click(screen.getByText("Save task"));
    expect(await screen.findByText("Revision conflict")).toBeTruthy();
    expect(screen.getByLabelText("Task title")).toBeTruthy();
  });
  it("gives another member a read-only form and disables editing", () => {
    editor(task, vi.fn(), { ...identity, userId: "someone-else" });
    expect(screen.queryByText("Save task")).toBeNull();
    expect(
      (screen.getByLabelText("Task title") as HTMLInputElement).closest("fieldset")?.disabled,
    ).toBe(true);
  });
  it("archives and restores a record without calling delete", async () => {
    mocks.list.mockImplementation(async () => ({ tasks: [task], truncated: false }));
    mocks.personalCounts.mockResolvedValue([]);
    mocks.archive.mockImplementation(async (_, archived) => {
      mocks.list.mockResolvedValue({
        tasks: [{ ...task, archived_at: archived ? "2026-10-04T01:00:00Z" : null }],
        truncated: false,
      });
    });
    board();
    fireEvent.click(await screen.findByText("Archive task"));
    expect(await screen.findByText("Task archived. Restore it from Archived.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "archived" } });
    fireEvent.click(await screen.findByText("Restore task"));
    await waitFor(() =>
      expect(mocks.archive).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: task.id }),
        false,
      ),
    );
  });
  it("renders source-backed blocker and dependency state", async () => {
    mocks.list.mockResolvedValue({
      tasks: [
        {
          ...task,
          status: "blocked",
          blocked_because: "Awaiting access",
          depends_on_task_id: "missing",
        },
      ],
      truncated: false,
    });
    mocks.personalCounts.mockResolvedValue([]);
    board();
    expect(await screen.findByText("Awaiting access")).toBeTruthy();
    expect(screen.getByText("Linked task unavailable in this view")).toBeTruthy();
  });
});
