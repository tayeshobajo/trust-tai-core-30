/**
 * The execution track.
 *
 * A quiet reading of where a piece of delivery stands: the four states work
 * actually passes through, with the current one named. Blocked is not a stage,
 * it is a condition, so it is shown beside the track rather than inside it.
 */

import type { ExecutionProject, ExecutionState } from "@/domain/projects";
import { EXECUTION_STATE_LABEL } from "@/domain/projects";
import { cn } from "@/lib/utils";

const TRACK: ExecutionState[] = ["not_started", "in_flight", "in_review", "delivered"];

function positionOf(state: ExecutionState): number {
  if (state === "blocked") return 1;
  if (state === "closed") return TRACK.length - 1;
  return Math.max(0, TRACK.indexOf(state));
}

export function StateTrack({
  state,
  className,
}: {
  state: ExecutionState;
  className?: string;
}) {
  const current = positionOf(state);
  const blocked = state === "blocked";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ol className="flex items-center gap-1.5" aria-label="Execution state">
        {TRACK.map((step, index) => {
          const done = index < current;
          const isCurrent = index === current;
          return (
            <li key={step} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "h-1.5 rounded-full transition-colors",
                  isCurrent ? "w-8" : "w-4",
                  blocked && isCurrent
                    ? "bg-destructive"
                    : isCurrent
                      ? "bg-royal"
                      : done
                        ? "bg-foreground/30"
                        : "bg-border",
                )}
              />
              <span className="sr-only">
                {EXECUTION_STATE_LABEL[step]}
                {isCurrent ? " (current)" : done ? " (passed)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {EXECUTION_STATE_LABEL[state]}
      </span>
    </div>
  );
}

export function daysAgo(at: string, now: Date = new Date()): number {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

export function movedPhrase(project: ExecutionProject, now: Date = new Date()): string {
  const days = daysAgo(project.lastMovedAt, now);
  if (days === 0) return "Moved today";
  if (days === 1) return "Moved yesterday";
  return `Moved ${days} days ago`;
}
