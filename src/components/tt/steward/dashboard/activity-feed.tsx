/**
 * AI teammate activity feed for the per-person dashboard.
 *
 * Self reads real rows from the shared activities stream: title, subline,
 * relative time, and an Undo affordance only when the row is reversible and
 * has not already been undone. Team sees counts only, an honest "N cleared
 * this week" line, never a per-item title and never Undo.
 */

import { Bot, CheckCircle2, RotateCcw } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { TTButton } from "@/components/tt/primitives";
import type { DashboardActivity } from "@/data/steward/dashboard-read";
import { cn } from "@/lib/utils";

function relativeTime(iso: string, nowISO: string): string {
  const ms = Date.parse(nowISO) - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function iconFor(eventType: string) {
  if (eventType === "task.status_changed") return <Bot aria-hidden className="size-4 text-royal" />;
  return <CheckCircle2 aria-hidden className="size-4 text-success" />;
}

export function ActivityFeed({
  activities,
  now,
  scope,
  clearedCount,
  minutesSaved,
  onUndo,
  viewAllHref,
}: {
  activities: DashboardActivity[];
  now: string;
  scope: "self" | "team";
  clearedCount: number;
  minutesSaved: number;
  onUndo: (activity: DashboardActivity) => void;
  viewAllHref: string;
}) {
  const hours = minutesSaved > 0 ? Math.round((minutesSaved / 60) * 10) / 10 : 0;

  if (scope === "team") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="tt-eyebrow">AI teammate activity</p>
        <p className="mt-3 text-sm text-foreground">
          {clearedCount <= 0
            ? "Nothing cleared for this teammate yet this week."
            : `Captain cleared ${clearedCount} thing${clearedCount === 1 ? "" : "s"} for this teammate this week.`}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-1 flex items-end justify-between gap-3">
        <p className="tt-eyebrow">AI teammate activity</p>
        <Link to={viewAllHref} className="text-sm text-royal hover:underline">
          View all activity →
        </Link>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">Internal and reversible only.</p>

      {activities.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul>
          {activities.map((activity) => (
            <li
              key={activity.id}
              className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
            >
              <span className="mt-0.5 shrink-0">{iconFor(activity.eventType)}</span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm text-foreground",
                    activity.undone && "text-muted-foreground line-through",
                  )}
                >
                  {activity.summary}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{relativeTime(activity.occurredAt, now)}</span>
                  {activity.needsReview ? (
                    <span className="rounded-full border border-warning/30 bg-warning/8 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
                      Needs review
                    </span>
                  ) : null}
                  {activity.undone ? (
                    <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Undone
                    </span>
                  ) : null}
                </p>
              </div>
              {activity.reversible && !activity.undone ? (
                <TTButton
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() => onUndo(activity)}
                  className="shrink-0"
                >
                  <RotateCcw aria-hidden className="size-3.5" />
                  Undo
                </TTButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
        {clearedCount <= 0
          ? "Nothing cleared for you yet this week."
          : `${clearedCount} action${clearedCount === 1 ? "" : "s"} cleared for you this week. ${
              hours > 0 ? `That's ${hours} hour${hours === 1 ? "" : "s"} saved.` : ""
            }`.trim()}
      </p>
    </div>
  );
}
