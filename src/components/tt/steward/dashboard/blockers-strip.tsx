/**
 * The blockers strip. Real overdue-and-blocked tasks only, or an honest empty
 * state. Self and team read the same real rows; team never sees titles.
 */

import { AlertTriangle, Coffee } from "lucide-react";

import type { StewardTask } from "@/domain/steward-accountability";

function blockersOf(tasks: StewardTask[]): StewardTask[] {
  return tasks.filter((task) => task.state === "blocked" || (task.overdue && task.state !== "complete"));
}

export function BlockersStrip({
  tasks,
  scope,
}: {
  tasks: StewardTask[];
  scope: "self" | "team";
}) {
  const blockers = blockersOf(tasks);

  if (blockers.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-royal/8 text-royal">
          <Coffee aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">No blockers right now</p>
          <p className="text-[11px] text-muted-foreground">You are all clear. If something needs your attention, it will show up here.</p>
        </div>
        <p className="hidden text-[11px] text-muted-foreground sm:block">Keep the momentum going.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-warning/25 bg-warning/8 px-6 py-4">
      <div className="flex items-center gap-2 text-warning">
        <AlertTriangle aria-hidden className="size-4" />
        <p className="tt-eyebrow text-warning">
          {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
        </p>
      </div>
      {scope === "self" ? (
        <ul className="mt-2 space-y-1">
          {blockers.map((task) => (
            <li key={task.key} className="truncate text-sm text-foreground">
              {task.title}
              {task.overdue ? " (overdue)" : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
