/**
 * "My tasks" for the per-person dashboard.
 *
 * Self sees the real checklist: title, source, due date, owner, an actionable
 * checkbox. Team sees only a status strip, counts, never a title and never an
 * action, so a teammate's task detail cannot leak into someone else's view.
 */

import { Link } from "@tanstack/react-router";
import { Check, MoreHorizontal, Plus, UserRoundCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { TTButton } from "@/components/tt/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardPagination } from "@/components/tt/steward/dashboard/dashboard-pagination";
import { completeAuthority, reassignAuthority, type StewardActor } from "@/data/steward/authority";
import { paginate } from "@/data/pagination";
import type { StewardTask } from "@/domain/steward-accountability";
import { cn } from "@/lib/utils";

type Group = "overdue" | "due_soon" | "later" | "done";
const TASKS_PER_PAGE = 6;

const GROUP_LABEL: Record<Group, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  later: "Later",
  done: "Done",
};

function groupOf(task: StewardTask, nowISO: string): Group {
  if (task.state === "complete") return "done";
  if (task.overdue) return "overdue";
  if (!task.dueAt) return "later";
  const days = Math.floor((Date.parse(task.dueAt) - Date.parse(nowISO)) / 86_400_000);
  return days <= 7 ? "due_soon" : "later";
}

function groupTasks(tasks: StewardTask[], nowISO: string): Record<Group, StewardTask[]> {
  const grouped: Record<Group, StewardTask[]> = { overdue: [], due_soon: [], later: [], done: [] };
  for (const task of tasks) grouped[groupOf(task, nowISO)].push(task);
  return grouped;
}

function TaskListRow({
  task,
  onToggle,
  onReassign,
  actor,
  pending,
  onOpen,
}: {
  task: StewardTask;
  onToggle: (task: StewardTask) => void;
  onReassign?: (task: StewardTask) => void;
  actor: StewardActor;
  pending: boolean;
  onOpen?: (task: StewardTask) => void;
}) {
  const done = task.state === "complete";
  const completion = completeAuthority(task, actor);
  const reassignment = reassignAuthority(task, actor);
  return (
    <li className={cn("flex min-h-10 items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0", done && "bg-success/[0.03]")}>
      <span title={completion.because ?? undefined} className="inline-flex">
        <Checkbox
          aria-label={done ? `${task.title} is complete` : `Mark ${task.title} complete`}
          checked={done}
          disabled={done || !completion.allowed || pending}
          onCheckedChange={() => completion.allowed && !pending && onToggle(task)}
        />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(task)}
            className={cn("truncate text-left text-xs font-medium text-foreground hover:text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", done && "text-muted-foreground line-through")}
          >
            {task.title}
          </button>
        ) : (
          <p className={cn("truncate text-xs font-medium text-foreground", done && "text-muted-foreground line-through")}>
            {task.title}
          </p>
        )}
        <span className="hidden shrink-0 rounded-full bg-royal/8 px-2 py-0.5 text-[10px] text-royal sm:inline">
          {task.companyLabel ?? task.projectName ?? task.sourceLabel}
        </span>
      </div>
      <span className={cn("shrink-0 text-[10px]", task.overdue ? "text-destructive" : "text-muted-foreground")}>
        {task.dueAt ? task.dueAt.slice(0, 10) : "No date"}
      </span>
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-royal/8 text-[9px] font-medium text-royal"
        title={task.owner.name}
      >
        {task.owner.kind === "agent" ? "AI" : task.owner.initials}
      </span>
      {done ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success">
          <Check aria-hidden className="size-3" /> Complete
        </span>
      ) : onReassign ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${task.title}`}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!reassignment.allowed}
              onSelect={() => reassignment.allowed && onReassign(task)}
            >
              <UserRoundCog aria-hidden className="size-4" />
              Assign
            </DropdownMenuItem>
            {!reassignment.allowed ? (
              <p className="max-w-56 px-2 py-1.5 text-[11px] text-muted-foreground">
                {reassignment.because}
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

export function MyTasksPanel({
  tasks,
  now,
  scope,
  onToggle,
  onCreate,
  onReassign,
  actor,
  completingTaskKey,
  taskStorageAvailable = true,
  onOpen,
  viewAllHref,
}: {
  tasks: StewardTask[];
  now: string;
  scope: "self" | "team";
  onToggle: (task: StewardTask) => void;
  onCreate?: () => void;
  onReassign?: (task: StewardTask) => void;
  actor: StewardActor;
  completingTaskKey?: string | null;
  taskStorageAvailable?: boolean;
  onOpen?: (task: StewardTask) => void;
  viewAllHref: string;
}) {
  const [page, setPage] = useState(1);
  const orderedTasks = useMemo(
    () => [...tasks].sort((a, b) => Number(a.state === "complete") - Number(b.state === "complete") || a.rank - b.rank),
    [tasks],
  );
  const openTasks = useMemo(() => tasks.filter((task) => task.state !== "complete"), [tasks]);
  const view = useMemo(() => paginate(orderedTasks, page, TASKS_PER_PAGE), [orderedTasks, page]);
  const grouped = groupTasks(view.rows, now);
  const groups: Group[] = ["overdue", "due_soon", "later", "done"];

  useEffect(() => {
    if (view.page !== page) setPage(view.page);
  }, [page, view.page]);

  if (scope === "team") {
    const teamGroups = groupTasks(tasks, now);
    const open = openTasks;
    const overdue = teamGroups.overdue.length;
    const dueSoon = teamGroups.due_soon.length;
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="tt-eyebrow">Tasks</p>
        <p className="mt-3 text-sm text-foreground">
          {open.length} open, {overdue} overdue, {dueSoon} due this week.
        </p>
      </div>
    );
  }

  const hasAny = openTasks.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-1 flex items-center justify-between gap-3 px-1">
        <h2 className="font-display text-base font-semibold text-foreground">My tasks</h2>
        <div className="flex items-center gap-2">
          {onCreate ? (
            <TTButton type="button" size="sm" onClick={onCreate} disabled={!taskStorageAvailable} className="h-7 px-2.5 text-[11px]">
              <Plus aria-hidden className="size-3.5" /> New task
            </TTButton>
          ) : null}
          <Link to={viewAllHref} className="text-[11px] text-royal hover:underline">
            View all →
          </Link>
        </div>
      </div>

      {!taskStorageAvailable ? (
        <p className="mx-1 mb-2 rounded-md border border-warning/25 bg-warning/8 px-3 py-2 text-[11px] text-foreground">
          Tasks can be viewed, but new tasks cannot be saved right now.
        </p>
      ) : null}

      {hasAny ? (
        <div>
          {groups.map((group) =>
            grouped[group].length > 0 ? (
              <section key={group} className="mt-2 first:mt-0">
                <p className={cn(
                  "rounded-md px-3 py-1 text-[10px] font-semibold",
                  group === "overdue" && "bg-destructive/8 text-destructive",
                  group === "due_soon" && "bg-warning/10 text-warning",
                  group === "later" && "bg-secondary text-muted-foreground",
                  group === "done" && "bg-success/10 text-success",
                )}>
                  {GROUP_LABEL[group]} ({grouped[group].length})
                </p>
                <ul>
                  {grouped[group].map((task) => (
                    <TaskListRow
                      key={task.key}
                      task={task}
                      onToggle={onToggle}
                      actor={actor}
                      pending={completingTaskKey === task.key}
                      {...(onReassign ? { onReassign } : {})}
                      {...(onOpen ? { onOpen } : {})}
                    />
                  ))}
                </ul>
              </section>
            ) : null,
          )}
          <DashboardPagination view={view} onPage={setPage} label="My tasks pagination" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing open. You are caught up.</p>
      )}
    </div>
  );
}
