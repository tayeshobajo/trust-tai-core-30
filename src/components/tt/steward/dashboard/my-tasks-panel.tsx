/**
 * "My tasks" for the per-person dashboard.
 *
 * Self sees the real checklist: title, source, due date, owner, an actionable
 * checkbox. Team sees only a status strip, counts, never a title and never an
 * action, so a teammate's task detail cannot leak into someone else's view.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { DashboardPagination } from "@/components/tt/steward/dashboard/dashboard-pagination";
import { paginate } from "@/data/pagination";
import type { StewardTask } from "@/domain/steward-accountability";
import { cn } from "@/lib/utils";

type Group = "overdue" | "due_soon" | "later";
const TASKS_PER_PAGE = 6;

const GROUP_LABEL: Record<Group, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  later: "Later",
};

function groupOf(task: StewardTask, nowISO: string): Group {
  if (task.overdue) return "overdue";
  if (!task.dueAt) return "later";
  const days = Math.floor((Date.parse(task.dueAt) - Date.parse(nowISO)) / 86_400_000);
  return days <= 7 ? "due_soon" : "later";
}

function groupTasks(tasks: StewardTask[], nowISO: string): Record<Group, StewardTask[]> {
  const open = tasks.filter((task) => task.state !== "complete");
  const grouped: Record<Group, StewardTask[]> = { overdue: [], due_soon: [], later: [] };
  for (const task of open) grouped[groupOf(task, nowISO)].push(task);
  return grouped;
}

function TaskListRow({
  task,
  onToggle,
}: {
  task: StewardTask;
  onToggle: (task: StewardTask) => void;
}) {
  return (
    <li className="flex min-h-9 items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0">
      <Checkbox
        aria-label={`Mark ${task.title} complete`}
        checked={false}
        onCheckedChange={() => onToggle(task)}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p className="truncate text-xs font-medium text-foreground">{task.title}</p>
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
    </li>
  );
}

export function MyTasksPanel({
  tasks,
  now,
  scope,
  onToggle,
  viewAllHref,
}: {
  tasks: StewardTask[];
  now: string;
  scope: "self" | "team";
  onToggle: (task: StewardTask) => void;
  viewAllHref: string;
}) {
  const [page, setPage] = useState(1);
  const openTasks = useMemo(() => tasks.filter((task) => task.state !== "complete"), [tasks]);
  const view = useMemo(() => paginate(openTasks, page, TASKS_PER_PAGE), [openTasks, page]);
  const grouped = groupTasks(view.rows, now);
  const groups: Group[] = ["overdue", "due_soon", "later"];

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
        <Link to={viewAllHref} className="text-[11px] text-royal hover:underline">
          View all tasks →
        </Link>
      </div>

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
                )}>
                  {GROUP_LABEL[group]} ({grouped[group].length})
                </p>
                <ul>
                  {grouped[group].map((task) => (
                    <TaskListRow key={task.key} task={task} onToggle={onToggle} />
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
