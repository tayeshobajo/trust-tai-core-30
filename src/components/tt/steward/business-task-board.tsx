import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cmdTasks } from "@/data/supabase/cmd-tasks";
import { useTaskChoices } from "@/data/steward/task-choices";
import {
  BOARD_STATUSES,
  BOARD_STATUS_LABEL,
  BOARD_WRITE_ROLES,
  BoardEditSchema,
  editOf,
  mayEditBoardTask,
  type BoardEdit,
  type BoardTask,
  type TaskVisibility,
} from "@/domain/cmd-tasks";
import { TTButton, TTInput } from "@/components/tt/primitives";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { taskContextHref } from "./task-context";

const control = "min-h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The task could not be saved.";
export function BusinessTaskBoard({
  identity,
  initialScope = "business",
}: {
  identity: WorkspaceIdentity;
  initialScope?: TaskVisibility;
}) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<TaskVisibility>(initialScope);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ task: BoardTask | null; key: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const queryKey = ["cmd-tasks", identity.organizationId, identity.userId, scope];
  const read = useQuery({ queryKey, queryFn: () => cmdTasks.list(identity.organizationId, scope) });
  const counts = useQuery({
    queryKey: ["cmd-personal-counts", identity.organizationId, identity.userId],
    queryFn: () => cmdTasks.personalCounts(identity.organizationId),
  });
  const choices = useTaskChoices(identity.organizationId, {
    userId: identity.userId,
    name: identity.name,
  });
  const tasks = read.data?.tasks ?? [];
  const actor = { userId: identity.userId, role: identity.role };
  const visible = tasks
    .filter((t) =>
      filter === "archived"
        ? !!t.archived_at
        : !t.archived_at && (filter === "active" ? t.status !== "complete" : t.status === filter),
    )
    .filter((t) =>
      `${t.title} ${t.owner_label ?? ""} ${t.next_action} ${t.blocked_because}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["cmd-tasks"] }),
      qc.invalidateQueries({ queryKey: ["cmd-personal-counts"] }),
      qc.invalidateQueries({ queryKey: ["steward"] }),
    ]);
  }
  async function archive(task: BoardTask) {
    setWorking(true);
    setNotice("");
    try {
      await cmdTasks.archive(task, !task.archived_at);
      await refresh();
      setNotice(task.archived_at ? "Task restored." : "Task archived. Restore it from Archived.");
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Task board</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Real work, its next action, and the evidence that it is finished.
          </p>
        </div>
        <Link to="/modules/steward/tasks" className="text-sm text-royal underline">
          Existing Steward checklist
        </Link>
      </header>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Task visibility">
        {(["business", "personal"] as const).map((value) => (
          <TTButton
            key={value}
            variant={scope === value ? "primary" : "secondary"}
            aria-pressed={scope === value}
            onClick={() => {
              setScope(value);
              setFilter("active");
              setSearch("");
              setEditor(null);
            }}
          >
            {value === "business" ? "Business tasks" : "My private tasks"}
          </TTButton>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {scope === "business"
          ? "Business task details are shared with active workspace members."
          : "Only you can read these task details. Teammates see status counts."}{" "}
        Historical Steward records retain their existing access until reviewed.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Search
          <TTInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find work"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Show
          <select className={control} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Active work</option>
            {BOARD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BOARD_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="archived">Archived</option>
          </select>
        </label>
        <TTButton variant="secondary" onClick={() => void refresh()} disabled={read.isFetching}>
          Refresh
        </TTButton>
        <TTButton
          onClick={() => setEditor({ task: null, key: `cmd-board:${crypto.randomUUID()}` })}
          disabled={!read.isSuccess || !BOARD_WRITE_ROLES.includes(identity.role)}
        >
          New task
        </TTButton>
      </div>
      {scope === "business" &&
      identity.organizationSlug === "trust-tai" &&
      read.isSuccess &&
      tasks.length === 0 &&
      ["owner", "admin"].includes(identity.role) ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm">
            The 22 approved launch tasks are ready to add, including the website audit checklist.
            Owners and due dates remain unassigned.
          </p>
          <TTButton
            variant="secondary"
            className="mt-3"
            disabled={working}
            onClick={async () => {
              setWorking(true);
              try {
                await cmdTasks.importPlannedWork(identity.organizationId);
                await refresh();
                setNotice("Approved business work added.");
              } catch (error) {
                setNotice(errorText(error));
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? "Adding planned work…" : "Add planned work"}
          </TTButton>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {notice}
      </p>
      {read.isPending ? (
        <p role="status">Loading tasks…</p>
      ) : read.isError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 p-4">
          <p>{errorText(read.error)}</p>
          <TTButton variant="secondary" onClick={() => void read.refetch()}>
            Try again
          </TTButton>
        </div>
      ) : (
        <>
          {read.data.truncated ? (
            <p role="status">
              Showing the most recent 1,000 records. This is not the complete board.
            </p>
          ) : null}
          {visible.length === 0 ? (
            <div className="rounded-xl border border-border p-6">
              <h2 className="font-display text-xl">No tasks in this view.</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a task or change the filter. Completed and archived work remain recoverable.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((task) => {
                const dependency = task.depends_on_task_id
                  ? tasks.find((row) => row.id === task.depends_on_task_id)
                  : null;
                return (
                  <li key={task.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="break-words text-lg font-medium">{task.title}</h2>
                        {task.parent_task_id ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Part of:{" "}
                            {tasks.find((parent) => parent.id === task.parent_task_id)?.title ??
                              "Parent unavailable in this view"}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm text-muted-foreground">
                          {task.owner_user_id
                            ? task.owner_label || "Assigned teammate (name unavailable)"
                            : "Unassigned"}{" "}
                          · {BOARD_STATUS_LABEL[task.status]}
                          {task.archived_at ? " · Archived" : ""}
                        </p>
                      </div>
                      <TTButton
                        variant="secondary"
                        onClick={() => setEditor({ task, key: task.id })}
                      >
                        {mayEditBoardTask(task, actor) ? "Open / edit" : "View task"}
                      </TTButton>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Next action</dt>
                        <dd className="break-words">
                          {task.status === "complete"
                            ? "Review the recorded result"
                            : task.next_action || "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Dependency</dt>
                        <dd>
                          {task.depends_on_task_id
                            ? dependency
                              ? `${dependency.title} · ${BOARD_STATUS_LABEL[dependency.status]}`
                              : "Linked task unavailable in this view"
                            : "None recorded"}
                        </dd>
                      </div>
                    </dl>
                    {task.status === "blocked" ? (
                      <p className="mt-3 break-words rounded-lg border border-warning/30 p-3 text-sm">
                        <strong>Blocked: </strong>
                        {task.blocked_because || "Reason not recorded"}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs text-muted-foreground">
                      {task.due_at ? `Due ${task.due_at.slice(0, 10)}` : "No due date"} · Updated{" "}
                      {new Date(task.updated_at).toLocaleString()}
                    </p>
                    {task.completed_at ? (
                      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
                        <p className="font-medium">
                          {task.status === "complete"
                            ? "Checked result"
                            : "Previous completion receipt — task reopened"}
                        </p>
                        <p className="whitespace-pre-wrap break-words">
                          {task.completion_evidence}
                        </p>
                        <p className="mt-1 text-xs">
                          Recorded {new Date(task.completed_at).toLocaleString()}
                          {task.completed_by === identity.userId ? " by you" : ""}
                        </p>
                      </div>
                    ) : null}
                    {mayEditBoardTask(task, actor) ? (
                      <button
                        type="button"
                        className="mt-3 min-h-11 text-sm underline"
                        disabled={working}
                        onClick={() => void archive(task)}
                      >
                        {task.archived_at ? "Restore task" : "Archive task"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <details className="rounded-xl border border-border p-4">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Team personal task status — counts only
        </summary>
        {counts.isPending ? (
          <p>Loading status counts…</p>
        ) : counts.isError ? (
          <p role="alert">Personal status counts are unavailable.</p>
        ) : counts.data.length ? (
          <ul className="space-y-2 text-sm">
            {counts.data.map((row) => (
              <li key={`${row.owner_user_id}:${row.status}`}>
                {row.owner_user_id === identity.userId
                  ? "You"
                  : choices.data?.people.find((p) => p.userId === row.owner_user_id)?.name ||
                    "Teammate"}{" "}
                ·{" "}
                {BOARD_STATUS_LABEL[row.status as keyof typeof BOARD_STATUS_LABEL] ??
                  "Unknown status"}
                : {row.task_count}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No classified personal tasks recorded.</p>
        )}
      </details>
      {editor ? (
        <TaskEditor
          key={editor.key}
          task={editor.task}
          scope={scope}
          identity={identity}
          tasks={tasks}
          people={choices.data?.people ?? []}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            if (editor.task) await cmdTasks.update(editor.task, input);
            else await cmdTasks.create(identity.organizationId, scope, editor.key, input);
            await refresh();
            setEditor(null);
            setNotice("Task saved.");
          }}
        />
      ) : null}
    </div>
  );
}

export function TaskEditor({
  task,
  scope,
  identity,
  tasks,
  people,
  onSave,
  onClose,
}: {
  task: BoardTask | null;
  scope: TaskVisibility;
  identity: WorkspaceIdentity;
  tasks: BoardTask[];
  people: { userId: string; name: string }[];
  onSave: (input: BoardEdit) => Promise<void>;
  onClose: () => void;
}) {
  const [openingElement] = useState(() => document.activeElement as HTMLElement | null);
  const [input, setInput] = useState<BoardEdit>(() =>
    task
      ? editOf(task)
      : {
          title: "",
          status: "open",
          next_action: "",
          blocked_because: "",
          depends_on_task_id: null,
          parent_task_id: null,
          notes: null,
          due_at: null,
          owner_user_id: scope === "personal" ? identity.userId : null,
          completion_evidence: "",
          acceptance_criteria: [],
          context_links: [],
        },
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState(false);
  const editable = !task
    ? BOARD_WRITE_ROLES.includes(identity.role)
    : mayEditBoardTask(task, { userId: identity.userId, role: identity.role });
  const admin = ["owner", "admin"].includes(identity.role);
  const completing = input.status === "complete" && task?.status !== "complete";
  function field<K extends keyof BoardEdit>(name: K, value: BoardEdit[K]) {
    setInput((old) => ({ ...old, [name]: value }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!editable || saving) return;
    if (completing && !checked) {
      setError("Confirm that you checked the result before recording delivery.");
      return;
    }
    const parsed = BoardEditSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the task details.");
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          if (openingElement?.isConnected) {
            event.preventDefault();
            openingElement.focus();
          }
        }}
      >
        <SheetHeader>
          <SheetTitle>{task ? "Task details" : "New task"}</SheetTitle>
          <SheetDescription>
            {scope === "business"
              ? "Shared business work."
              : "Private task detail; team sees counts only."}{" "}
            Saving does not execute or publish anything.
          </SheetDescription>
        </SheetHeader>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <fieldset disabled={!editable || saving} className="space-y-4 disabled:opacity-80">
            <label className="grid gap-1 text-sm">
              Task title
              <TTInput
                autoFocus
                required
                maxLength={500}
                value={input.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Status
              <select
                className={control}
                value={input.status}
                onChange={(e) => {
                  field("status", e.target.value as BoardEdit["status"]);
                  setChecked(false);
                }}
              >
                {BOARD_STATUSES.filter((s) => task || s !== "complete").map((s) => (
                  <option key={s} value={s}>
                    {BOARD_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Next action
              <Textarea
                value={input.next_action}
                maxLength={4000}
                onChange={(e) => field("next_action", e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Blocker{input.status === "blocked" ? " (required)" : ""}
              <Textarea
                required={input.status === "blocked"}
                value={input.blocked_because}
                onChange={(e) => field("blocked_because", e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Parent task (optional)
              <select
                className={control}
                value={input.parent_task_id ?? ""}
                onChange={(e) => field("parent_task_id", e.target.value || null)}
              >
                <option value="">Top-level task</option>
                {input.parent_task_id && !tasks.some((t) => t.id === input.parent_task_id) ? (
                  <option value={input.parent_task_id}>Linked parent unavailable</option>
                ) : null}
                {tasks
                  .filter(
                    (t) =>
                      t.id !== task?.id &&
                      !t.parent_task_id &&
                      (t.id === input.parent_task_id ||
                        mayEditBoardTask(t, { userId: identity.userId, role: identity.role })),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Depends on
              <select
                className={control}
                value={input.depends_on_task_id ?? ""}
                onChange={(e) => field("depends_on_task_id", e.target.value || null)}
              >
                <option value="">No dependency</option>
                {input.depends_on_task_id &&
                !tasks.some((t) => t.id === input.depends_on_task_id) ? (
                  <option value={input.depends_on_task_id}>Linked task unavailable</option>
                ) : null}
                {tasks
                  .filter((t) => t.id !== task?.id)
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.title}
                      {t.archived_at ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Owner
              <select
                className={control}
                disabled={scope === "personal" || (!admin && !!task)}
                value={input.owner_user_id ?? ""}
                onChange={(e) => field("owner_user_id", e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {input.owner_user_id && !people.some((p) => p.userId === input.owner_user_id) ? (
                  <option value={input.owner_user_id}>
                    {task?.owner_label || "Assigned teammate (name unavailable)"}
                  </option>
                ) : null}
                {people
                  .filter((p) => admin || p.userId === identity.userId)
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Due date (optional)
              <input
                className={control}
                type="date"
                value={input.due_at?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  field("due_at", e.target.value ? `${e.target.value}T00:00:00.000Z` : null)
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Planned acceptance criteria (one per line)
              <Textarea
                value={input.acceptance_criteria.join("\n")}
                onChange={(e) => field("acceptance_criteria", e.target.value.split("\n"))}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Acceptance criteria describe the intended result, not proof of delivery.
            </p>
            <label className="grid gap-1 text-sm">
              Notes
              <Textarea
                value={input.notes ?? ""}
                onChange={(e) => field("notes", e.target.value || null)}
              />
            </label>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Source links</h3>
              {input.context_links.map((link, index) => (
                <div key={index} className="space-y-1 rounded-lg border p-2">
                  <label className="grid gap-1 text-sm">
                    Source {index + 1} label
                    <TTInput
                      value={link.label}
                      onChange={(e) =>
                        field(
                          "context_links",
                          input.context_links.map((v, i) =>
                            i === index ? { ...v, label: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Source {index + 1} URL
                    <TTInput
                      type="url"
                      value={link.url}
                      onChange={(e) =>
                        field(
                          "context_links",
                          input.context_links.map((v, i) =>
                            i === index ? { ...v, url: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="min-h-11 text-sm underline"
                    onClick={() =>
                      field(
                        "context_links",
                        input.context_links.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove link {index + 1}
                  </button>
                </div>
              ))}
              <TTButton
                type="button"
                variant="secondary"
                onClick={() =>
                  field("context_links", [...input.context_links, { label: "", url: "" }])
                }
              >
                Add source link
              </TTButton>
            </div>
            {input.status === "complete" ? (
              <>
                <label className="grid gap-1 text-sm">
                  Checked result and evidence
                  <Textarea
                    required
                    minLength={10}
                    disabled={task?.status === "complete"}
                    value={input.completion_evidence}
                    onChange={(e) => field("completion_evidence", e.target.value)}
                    placeholder="What did you verify, how, and where is the supporting result?"
                  />
                </label>
                {completing ? (
                  <label className="flex min-h-11 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                    />
                    I checked the result against the acceptance criteria.
                  </label>
                ) : (
                  <p className="text-xs">
                    Reopen this task before replacing its completion evidence.
                  </p>
                )}
              </>
            ) : null}
          </fieldset>
          {!editable ? (
            <p className="text-sm text-muted-foreground">
              Read only. The creator, assignee or an authorized business admin can update shared
              work.
            </p>
          ) : (
            <TTButton type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save task"}
            </TTButton>
          )}
          <TTButton type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Close
          </TTButton>
        </form>
        {task?.context_links.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {task.context_links.map((link, i) => {
              const href = taskContextHref(link.url);
              return (
                <li key={i}>
                  {href ? (
                    <a
                      className="text-royal underline"
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.label || href}
                    </a>
                  ) : (
                    link.label
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
