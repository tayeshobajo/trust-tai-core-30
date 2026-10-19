import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  Search,
  X,
  Link as LinkIcon,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TTButton } from "@/components/tt/primitives";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  completionOf,
  confirmedRows,
  isWorkComplete,
  meetingMatches,
} from "@/domain/steward-completion";
import { workroomRowKey } from "@/domain/steward-meeting-links";
import { BOARD_STATUS_LABEL } from "@/domain/cmd-tasks";
import type { WorkroomMeeting, WorkroomRow } from "@/domain/steward-workroom";
import { taskUpdates } from "@/data/supabase/steward-updates";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { ExistingTaskTools, WorkroomView, type WorkroomViewProps } from "./workroom-view";

export interface ApprovedMeetingsProps extends WorkroomViewProps {
  identity: WorkspaceIdentity;
  updates?: Pick<typeof taskUpdates, "list" | "post">;
  canChange: (row: WorkroomRow) => boolean;
  onStatus: (row: WorkroomRow, status: string, note: string) => Promise<void>;
}
function statusLabel(row: WorkroomRow) {
  return row.boardTask
    ? isWorkComplete(row)
      ? "Completed"
      : BOARD_STATUS_LABEL[row.boardTask.status]
    : { open: "Planned", waiting: "Waiting", kept: "Completed", released: "Released" }[
        row.status
      ] || row.status;
}
function Completion({ meeting, known = true }: { meeting: WorkroomMeeting; known?: boolean }) {
  if (!known)
    return (
      <p className="text-sm text-muted-foreground">
        Completion unavailable until all tasks are read.
      </p>
    );
  const score = completionOf(meeting);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-4">
        <span>
          {score.total ? `${score.completed} of ${score.total} complete` : "No confirmed actions"}
        </span>
        <strong className="text-xl text-foreground">
          {score.percentage === null ? "—" : `${score.percentage}%`}
        </strong>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100" aria-hidden>
        <div
          className={`h-full rounded-full ${score.percentage === 100 ? "bg-green-600" : "bg-royal"}`}
          style={{ width: `${score.percentage ?? 0}%` }}
        />
      </div>
    </div>
  );
}
const inputClass =
  "min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-royal";

export function ApprovedMeetings(props: ApprovedMeetingsProps) {
  const [advanced, setAdvanced] = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [search, setSearch] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [showCompleted, setShowCompleted] = useState(false);
  const [local, setLocal] = useState<{ meetingId: string | null; rowKey: string | null }>({
    meetingId: null,
    rowKey: null,
  });
  const selection = props.selection ?? local;
  const select = (meetingId: string | null, rowKey: string | null) => {
    setLocal({ meetingId, rowKey });
    props.onSelect?.(meetingId, rowKey);
  };
  const meeting = props.meetings.find((m) => m.id === selection.meetingId);
  const row = meeting?.rows.find((r) => workroomRowKey(r) === selection.rowKey);
  const scoresReady = props.linkedRead?.state === "ready" && !props.linkedRead.truncated;
  const total = props.meetings.reduce((n, m) => n + completionOf(m).open, 0);
  const overdue = props.meetings.reduce((n, m) => n + completionOf(m).overdue, 0);
  const filtered = props.meetings
    .filter((m) => meetingMatches(m, search, filter))
    .sort((a, b) => (sort === "newest" ? -1 : 1) * a.occurredAt.localeCompare(b.occurredAt));
  const close = () => select(meeting?.id ?? null, null);
  const pane =
    meeting && row ? (
      <TaskPane
        key={workroomRowKey(row)}
        {...props}
        meeting={props.meetings.find((m) => m.id === row.forwardedFrom) ?? meeting}
        row={row}
        onClose={close}
      />
    ) : null;
  const tasks =
    meeting?.rows.filter((r) => r.what.toLowerCase().includes(taskSearch.toLowerCase())) ?? [];
  const open = tasks.filter((r) => !isWorkComplete(r));
  const done = tasks.filter(isWorkComplete);
  if (advanced)
    return (
      <>
        <button className="m-4 min-h-11 text-royal" onClick={() => setAdvanced(false)}>
          Back to meetings overview
        </button>
        <WorkroomView {...props} />
      </>
    );
  return (
    <div
      className="min-h-full bg-white text-foreground dark:bg-background"
      data-testid="approved-meetings"
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <span className="text-sm font-semibold">Steward</span>
        <div className="flex items-center gap-4">
          <button className="min-h-10 text-sm text-royal" onClick={() => setAdvanced(true)}>
            More meeting tools
          </button>
          {props.headerMenu}
        </div>
      </div>
      {props.linkedRead?.state !== "ready" || props.linkedRead.truncated ? (
        <p role="status" className="mx-6 mt-4 rounded-lg border border-border p-3 text-sm">
          {props.linkedRead?.state === "error"
            ? "Some task data could not be read. Completion totals may be incomplete."
            : props.linkedRead?.state === "loading"
              ? "Reading linked tasks…"
              : "The task read limit was reached; completion totals are unavailable."}
        </p>
      ) : null}
      {selection.meetingId && !meeting ? (
        <div className="p-8">
          <h1 className="text-2xl font-semibold">Meeting unavailable</h1>
          <p className="my-4">This meeting is not available in the current workspace view.</p>
          <TTButton onClick={() => select(null, null)}>Back to meetings</TTButton>
        </div>
      ) : !meeting ? (
        <main className="p-6 md:p-9">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">Meetings</h1>
              <p className="mt-2 text-lg text-muted-foreground">
                See what’s complete and what still needs attention.
              </p>
            </div>
            <TTButton asChild variant="secondary">
              <Link to="/modules/steward/meetings">Add meeting</Link>
            </TTButton>
          </div>
          <p className="my-7 text-muted-foreground">
            {props.meetings.length} meetings ·{" "}
            {scoresReady
              ? `${total} open actions${overdue ? ` · ${overdue} overdue` : ""}`
              : "Completion totals unavailable"}
          </p>
          <div className="mb-6 flex flex-wrap items-center gap-5">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <Search className="size-5" />
              <input
                className={`${inputClass} w-full`}
                placeholder="Search meetings…"
                aria-label="Search meetings"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-4" aria-label="Meeting filters">
              {[
                ["all", "All meetings"],
                ["open", "With open actions"],
                ["review", "Awaiting review"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value!)}
                  className={`min-h-11 border-b-2 px-1 text-sm ${filter === value ? "border-royal text-royal" : "border-transparent text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              className={inputClass}
              aria-label="Meeting order"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_90px_140px_20px] gap-6 border-b border-border px-4 py-3 text-xs uppercase text-muted-foreground lg:grid">
            <span>Meeting</span>
            <span>Confirmed actions</span>
            <span>Open</span>
            <span>Due</span>
            <span />
          </div>
          {filtered.length ? (
            filtered.map((m) => {
              const score = completionOf(m);
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setTaskSearch("");
                    setShowCompleted(false);
                    select(m.id, null);
                  }}
                  className="grid w-full grid-cols-[1fr_20px] items-center gap-5 border-b border-border px-4 py-6 text-left transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-royal lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_90px_140px_20px]"
                >
                  <div className="flex gap-4">
                    <CalendarDays className="mt-1 size-6 shrink-0" />
                    <div>
                      <h2 className="text-lg font-semibold">{m.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {new Date(m.occurredAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      {m.openProposals > 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {m.openProposals} awaiting review
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="col-start-1 lg:col-auto">
                    <Completion meeting={m} known={scoresReady} />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {scoresReady && score.total ? `${score.open} open` : "—"}
                  </span>
                  <span
                    className={`text-sm ${score.overdue ? "text-destructive" : score.percentage === 100 ? "text-green-700" : "text-muted-foreground"}`}
                  >
                    {!scoresReady
                      ? "—"
                      : score.overdue
                        ? `${score.overdue} overdue`
                        : score.percentage === 100
                          ? "All complete"
                          : m.openProposals
                            ? "Awaiting review"
                            : "—"}
                  </span>
                  <ChevronRight className="col-start-2 row-start-1 size-5 text-royal lg:col-auto lg:row-auto" />
                </button>
              );
            })
          ) : (
            <p role="status" className="py-12 text-muted-foreground">
              {props.meetings.length
                ? "No meetings match these filters."
                : "No saved meetings yet. Add a meeting to start reviewing its actions."}
            </p>
          )}
          <p className="mt-7 text-sm leading-6 text-muted-foreground">
            Completion = completed confirmed actions / all confirmed actions. Awaiting-review items
            are excluded.
            <br />
            Rolled-forward actions stay open in the original meeting and are counted only once.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing up to 60 saved meetings. Verification is separate from work completion.
          </p>
        </main>
      ) : (
        <div
          className={`grid min-w-0 ${row ? "xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]" : ""}`}
        >
          <main className="min-w-0 p-6 md:p-9">
            <button className="mb-4 min-h-10 text-sm text-royal" onClick={() => select(null, null)}>
              Meetings / {new Date(meeting.occurredAt).toLocaleDateString()}
            </button>
            <h1 className="text-3xl font-semibold">Meeting tasks</h1>
            <p className="mt-2 text-lg text-muted-foreground">{meeting.title}</p>
            <div className="my-7">
              <Completion meeting={meeting} known={scoresReady} />
              <p className="mt-2 text-sm text-muted-foreground">
                {scoresReady ? `${completionOf(meeting).open} still open · ` : ""}
                {meeting.openProposals} awaiting review, excluded
              </p>
            </div>
            <div className="mb-5 flex flex-wrap gap-3">
              <input
                className={`${inputClass} min-w-0 flex-1`}
                aria-label="Search tasks"
                placeholder="Search tasks…"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
              />
              <TTButton asChild variant="secondary">
                <Link
                  to="/modules/steward/meetings/$conversationId"
                  params={{ conversationId: meeting.id }}
                >
                  Review actions
                </Link>
              </TTButton>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              Confirmed actions · {confirmedRows(meeting).length}
            </p>
            {[...open, ...(showCompleted ? done : done.slice(0, 2))].map((r) => (
              <button
                key={workroomRowKey(r)}
                onClick={() => select(meeting.id, workroomRowKey(r))}
                className={`flex w-full items-center gap-4 border-b border-border px-3 py-5 text-left hover:bg-blue-50 ${row && workroomRowKey(row) === workroomRowKey(r) ? "border-l-4 border-l-royal bg-blue-50" : ""}`}
              >
                {isWorkComplete(r) ? (
                  <Check className="size-6 shrink-0 rounded-full bg-green-600 p-1 text-white" />
                ) : (
                  <Circle className="size-6 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.what}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {statusLabel(r)}
                    {r.forwardedFrom
                      ? " · Rolled forward, counted in original meeting"
                      : r.kind === "business-task"
                        ? " · Context only, excluded from score"
                        : ""}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-royal" />
              </button>
            ))}
            {!tasks.length ? (
              <p className="py-8 text-muted-foreground">
                {taskSearch
                  ? "No tasks match your search."
                  : "No confirmed actions yet. Review the meeting to confirm what was agreed."}
              </p>
            ) : null}
            {done.length > 2 ? (
              <button
                className="mt-4 min-h-11 text-sm text-royal"
                onClick={() => setShowCompleted(!showCompleted)}
              >
                {showCompleted
                  ? "Show fewer completed tasks"
                  : `Show ${done.length - 2} more completed tasks`}
              </button>
            ) : null}
            {selection.rowKey && !row ? (
              <p role="status" className="mt-4">
                This task is unavailable in this meeting.
              </p>
            ) : null}
          </main>
          {pane ? (
            <>
              {compact ? (
                <CompactPane title={row!.what} onClose={close}>
                  {pane}
                </CompactPane>
              ) : (
                <aside className="min-w-0 border-l border-border">{pane}</aside>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
function CompactPane({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // CSS hides the desktop copy; matchMedia avoids two live forms/queries on compact screens.
  return (
    <Sheet
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto bg-white p-0 sm:max-w-xl xl:hidden [&>button:first-child]:hidden">
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Task updates, details and evidence</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
function TaskPane(
  props: ApprovedMeetingsProps & {
    meeting: WorkroomMeeting;
    row: WorkroomRow;
    onClose: () => void;
  },
) {
  const { row, meeting, identity } = props;
  const [tab, setTab] = useState("Updates");
  const [note, setNote] = useState("");
  const [action, setAction] = useState<"update" | "roll_forward" | "complete">("update");
  const [laterDate, setLaterDate] = useState("");
  const [laterMeeting, setLaterMeeting] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const operation = useRef(crypto.randomUUID());
  const [message, setMessage] = useState("");
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ["steward", "updates", identity.organizationId, identity.userId, row.id],
    queryFn: () => (props.updates ?? taskUpdates).list(identity.organizationId, row.id),
  });
  const canChange = props.canChange(row);
  async function submit() {
    if (pending.current || !canChange) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (action === "complete")
        await props.onStatus(row, row.boardTask ? "complete" : "kept", note);
      else
        await (props.updates ?? taskUpdates).post({
          organizationId: identity.organizationId,
          taskId: row.id,
          kind: row.kind ?? "commitment",
          meetingId: meeting.id,
          operationId: operation.current,
          note,
          authorName: identity.name,
          laterMeetingId: action === "roll_forward" ? laterMeeting || null : null,
          laterDate: action === "roll_forward" ? laterDate || null : null,
          originalDue: row.due.exact ? row.due.label : null,
          action,
        });
      operation.current = crypto.randomUUID();
      setNote("");
      setAction("update");
      setLaterDate("");
      setLaterMeeting("");
      setMessage("Saved.");
      await qc.invalidateQueries({ queryKey: ["steward", "forwards"] });
      await qc.invalidateQueries({
        queryKey: ["steward", "updates", identity.organizationId, identity.userId, row.id],
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save. Your text is still here.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="min-w-0 p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Task details</span>
        <div className="flex gap-3">
          <button
            aria-label="Copy task link"
            className="p-2"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("meeting", meeting.id);
              url.searchParams.set("task", workroomRowKey(row));
              void navigator.clipboard.writeText(url.href).then(
                () => setMessage("Task link copied. Existing access rules still apply."),
                () => setMessage("Could not copy. Use the current page address."),
              );
            }}
          >
            <LinkIcon className="size-5" />
          </button>
          <button aria-label="Close task details" className="p-2" onClick={props.onClose}>
            <X className="size-5" />
          </button>
        </div>
      </div>
      <h2 className="break-words text-3xl font-semibold leading-tight tracking-tight">
        {row.what}
      </h2>
      <div className="my-6 flex flex-wrap items-center gap-3 text-sm">
        {row.boardTask ? (
          <button
            disabled={!canChange || busy}
            onClick={() => props.onEditTaskField?.(row, "status")}
            className="rounded-md bg-blue-50 px-3 py-2 text-royal"
          >
            Status: {statusLabel(row)}
          </button>
        ) : (
          <label>
            Status:{" "}
            <select
              aria-label="Task status"
              className={inputClass}
              value={row.status}
              disabled={!canChange || busy || isWorkComplete(row)}
              onChange={async (e) => {
                if (pending.current) return;
                pending.current = true;
                setBusy(true);
                try {
                  await props.onStatus(row, e.target.value, "");
                  setMessage("Status saved.");
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Could not save status.");
                } finally {
                  pending.current = false;
                  setBusy(false);
                }
              }}
            >
              <option value="open">Planned</option>
              <option value="waiting">Waiting</option>
              {row.kept ? <option value="kept">Completed</option> : null}
              {row.status === "released" ? <option value="released">Released</option> : null}
            </select>
          </label>
        )}
        <button
          disabled={!row.boardTask || !canChange}
          onClick={() => props.onEditTaskField?.(row, "owner")}
          className="p-2"
        >
          {row.owner.label}
        </button>
        <button
          disabled={!row.boardTask || !canChange}
          onClick={() => props.onEditTaskField?.(row, "due")}
          className="p-2"
        >
          {row.due.exact ? row.due.label : "No agreed date"}
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        <TTButton
          disabled={!canChange || isWorkComplete(row) || busy}
          onClick={() => {
            setAction("complete");
            setTab("Updates");
            setNote("");
          }}
        >
          ✓ Mark complete
        </TTButton>
        <TTButton
          variant="secondary"
          disabled={!canChange || isWorkComplete(row) || busy}
          onClick={() => {
            setAction("roll_forward");
            setTab("Updates");
            setNote("");
          }}
        >
          → Roll forward…
        </TTButton>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Choose a meeting or date · same task, full history.
        <br />
        Rolled-forward tasks stay open in the original meeting.
      </p>
      {!canChange ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Only the task’s authorized owner or manager can change this work.
        </p>
      ) : null}
      <div
        className="mb-7 mt-7 flex gap-6 border-b border-border"
        role="tablist"
        aria-label="Task sections"
      >
        {["Updates", "Details", "Evidence"].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-12 border-b-2 text-sm ${tab === t ? "border-royal text-royal" : "border-transparent text-muted-foreground"}`}
          >
            {t}
            {t === "Evidence" ? " · Review" : ""}
          </button>
        ))}
      </div>
      {message ? (
        <p role="status" className="mb-4 text-sm">
          {message}
        </p>
      ) : null}
      {tab === "Updates" ? (
        <div role="tabpanel" id="task-tab-panel" aria-labelledby={`task-tab-${tab}`}>
          <form
            className="rounded-lg border border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block text-sm">
              {action === "complete"
                ? "Record the result and supporting evidence"
                : action === "roll_forward"
                  ? "Why is this moving forward?"
                  : "Share progress, a decision, or a blocker…"}
              <textarea
                className="mt-2 min-h-24 w-full resize-y bg-transparent text-sm outline-offset-4"
                aria-label="Task update"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={4000}
                disabled={!canChange || busy}
              />
            </label>
            {action === "roll_forward" ? (
              <div className="mb-4 grid gap-3">
                <label className="text-sm">
                  Later date
                  <input
                    type="date"
                    className={`${inputClass} mt-1 w-full`}
                    value={laterDate}
                    onChange={(e) => {
                      setLaterDate(e.target.value);
                      setLaterMeeting("");
                    }}
                  />
                </label>
                <label className="text-sm">
                  Or later meeting
                  <select
                    className={`${inputClass} mt-1 w-full`}
                    value={laterMeeting}
                    onChange={(e) => {
                      setLaterMeeting(e.target.value);
                      setLaterDate("");
                    }}
                  >
                    <option value="">Choose a meeting</option>
                    {props.meetings
                      .filter((m) => m.occurredAt > meeting.occurredAt)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">
                  The agreed due date and original source stay unchanged. This records the follow-up
                  destination in the task’s history.
                </p>
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              {action !== "update" ? (
                <TTButton
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setAction("update");
                    setNote("");
                  }}
                >
                  Cancel
                </TTButton>
              ) : null}
              <TTButton
                type="submit"
                disabled={
                  busy ||
                  !canChange ||
                  note.trim().length < (action === "complete" ? 10 : 1) ||
                  (action === "roll_forward" && !laterDate && !laterMeeting)
                }
              >
                {busy
                  ? "Saving…"
                  : action === "complete"
                    ? "Confirm complete"
                    : action === "roll_forward"
                      ? "Save roll forward"
                      : "Post update"}
              </TTButton>
            </div>
          </form>
          <div className="mt-7 space-y-6">
            {history.isPending ? (
              <p>Reading updates…</p>
            ) : history.isError ? (
              <p role="alert">
                Updates could not be read.{" "}
                <button className="underline" onClick={() => void history.refetch()}>
                  Retry
                </button>
              </p>
            ) : history.data?.length ? (
              history.data.map((event) => (
                <article key={event.id} className="border-b border-border pb-5">
                  <p className="font-medium">
                    {event.payload?.author_name || event.actor_user_id || "Author not recorded"}
                  </p>
                  <time className="text-xs text-muted-foreground" dateTime={event.occurred_at}>
                    {new Date(event.occurred_at).toLocaleString()}
                  </time>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {event.payload?.note || event.summary}
                  </p>
                  {event.payload?.action === "roll_forward" ? (
                    <p className="mt-2 text-sm text-royal">
                      Rolled forward to{" "}
                      {event.payload.later_date ||
                        props.meetings.find((m) => m.id === event.payload.later_meeting_id)
                          ?.title ||
                        "a later meeting"}{" "}
                      · original obligation remains open.
                    </p>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No updates recorded yet. Share the next step when you’re ready.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Up to 100 latest updates. History is separate from verified evidence.
            </p>
          </div>
        </div>
      ) : tab === "Details" ? (
        <div
          role="tabpanel"
          id="task-tab-panel"
          aria-labelledby={`task-tab-${tab}`}
          className="space-y-5 text-sm"
        >
          <p>Owner: {row.owner.label}</p>
          <p>Agreed due date: {row.due.label}</p>
          {row.boardTask?.blocked_because ? <p>Blocked: {row.boardTask.blocked_because}</p> : null}
          <p>Original meeting: {meeting.title}</p>
          {row.boardTask?.notes ? (
            <p className="whitespace-pre-wrap">{row.boardTask.notes}</p>
          ) : null}
          <details>
            <summary className="cursor-pointer text-royal">
              More task tools and source details
            </summary>
            <div className="mt-4">
              <ExistingTaskTools
                meeting={meeting}
                row={row}
                commitment={props.commitmentFor(row.id)}
                history={props.historyFor?.(row.id)}
                taskById={props.taskById}
                backend={props.backend}
              />
            </div>
          </details>
        </div>
      ) : (
        <div
          role="tabpanel"
          id="task-tab-panel"
          aria-labelledby={`task-tab-${tab}`}
          className="space-y-4 text-sm"
        >
          <p>
            {
              "Work status does not mean the evidence has been verified. Open verification tools to review the evidence."
            }
          </p>
          <p className="whitespace-pre-wrap">
            {row.boardTask?.completion_evidence ||
              row.receipt?.completionNote ||
              "No completion evidence recorded."}
          </p>
          {props.commitmentFor(row.id)?.evidence.map((e, i) => (
            <blockquote key={i} className="border-l-2 border-border pl-4">
              {e.label}
            </blockquote>
          ))}
          <details>
            <summary className="cursor-pointer text-royal">Evidence and verification tools</summary>
            <div className="mt-4">
              <ExistingTaskTools
                meeting={meeting}
                row={row}
                commitment={props.commitmentFor(row.id)}
                history={props.historyFor?.(row.id)}
                taskById={props.taskById}
                backend={props.backend}
              />
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
