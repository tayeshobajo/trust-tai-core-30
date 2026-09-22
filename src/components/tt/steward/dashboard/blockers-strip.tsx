/**
 * The blockers strip. Real overdue-and-blocked tasks only, or an honest empty
 * state. Self and team read the same real rows; team never sees titles.
 */

import { AlertTriangle } from "lucide-react";

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
      <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-4">
        <p className="text-sm text-muted-foreground">No blockers right now.</p>
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
