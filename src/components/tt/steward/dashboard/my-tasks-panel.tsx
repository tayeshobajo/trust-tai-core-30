/**
 * "My tasks" for the per-person dashboard.
 *
 * Self sees the real checklist: title, source, due date, owner, an actionable
 * checkbox. Team sees only a status strip, counts, never a title and never an
 * action, so a teammate's task detail cannot leak into someone else's view.
 */

import { Link } from "@tanstack/react-router";
import { Checkbox } from "@/components/ui/checkbox";
import type { StewardTask } from "@/domain/steward-accountability";
import { cn } from "@/lib/utils";

type Group = "overdue" | "due_soon" | "later";

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
    <li className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <Checkbox
        aria-label={`Mark ${task.title} complete`}
        checked={false}
        onCheckedChange={() => onToggle(task)}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{task.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {task.companyLabel ?? task.projectName ?? task.sourceLabel}
        </p>
      </div>
      <span className={cn("text-xs", task.overdue ? "text-destructive" : "text-muted-foreground")}>
        {task.dueAt ? task.dueAt.slice(0, 10) : "No date"}
      </span>
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[10px] font-medium text-foreground"
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
  const grouped = groupTasks(tasks, now);
  const groups: Group[] = ["overdue", "due_soon", "later"];

  if (scope === "team") {
    const open = tasks.filter((task) => task.state !== "complete");
    const overdue = grouped.overdue.length;
    const dueSoon = grouped.due_soon.length;
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="tt-eyebrow">Tasks</p>
        <p className="mt-3 text-sm text-foreground">
          {open.length} open, {overdue} overdue, {dueSoon} due this week.
        </p>
      </div>
    );
  }

  const hasAny = tasks.some((task) => task.state !== "complete");

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <p className="tt-eyebrow">My tasks</p>
        <Link to={viewAllHref} className="text-sm text-royal hover:underline">
          View all tasks →
        </Link>
      </div>

      {hasAny ? (
        <div className="space-y-5">
          {groups.map((group) =>
            grouped[group].length > 0 ? (
              <section key={group}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing open. You are caught up.</p>
      )}
    </div>
  );
}
