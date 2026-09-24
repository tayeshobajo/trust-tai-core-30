/**
 * AI teammate activity feed for the per-person dashboard.
 *
 * Self reads real rows from the shared activities stream: title, subline,
 * relative time, and an Undo affordance only when the row is reversible and
 * has not already been undone. Team sees counts only, an honest "N cleared
 * this week" line, never a per-item title and never Undo.
 */

import { Bot, CheckCircle2, Info, RotateCcw, TrendingUp } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import { DashboardPagination } from "@/components/tt/steward/dashboard/dashboard-pagination";
import { paginate } from "@/data/pagination";
import type { DashboardActivity } from "@/data/steward/dashboard-read";
import { cn } from "@/lib/utils";

const ACTIVITIES_PER_PAGE = 5;

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
  const agentActivities = useMemo(
    () => activities.filter((activity) => activity.actorIsAgent),
    [activities],
  );
  const [page, setPage] = useState(1);
  const view = useMemo(
    () => paginate(agentActivities, page, ACTIVITIES_PER_PAGE),
    [agentActivities, page],
  );

  useEffect(() => {
    if (view.page !== page) setPage(view.page);
  }, [page, view.page]);

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
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 border-b border-border px-1 pb-2">
        <div className="min-w-0 flex items-center gap-2">
          <h2 className="font-display text-base font-semibold text-foreground">AI teammate activity</h2>
          <Info aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Internal and reversible only</span>
        </div>
        <Link to={viewAllHref} className="text-[11px] text-royal hover:underline">
          View all activity →
        </Link>
      </div>
      {agentActivities.length === 0 ? (
        <p className="px-1 py-4 text-sm text-muted-foreground">
          No verified AI teammate work has been recorded yet.
        </p>
      ) : (
        <ul className="min-w-0">
          {view.rows.map((activity) => (
            <li
              key={activity.id}
              className="flex min-h-12 items-center gap-2 border-b border-border px-1 py-1.5 last:border-b-0"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">{iconFor(activity.eventType)}</span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-xs font-medium text-foreground",
                    activity.undone && "text-muted-foreground line-through",
                  )}
                >
                  {activity.summary}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
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
                  className="h-7 shrink-0 px-2 text-[10px]"
                >
                  <RotateCcw aria-hidden className="size-3.5" />
                  Undo
                </TTButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <DashboardPagination view={view} onPage={setPage} label="AI teammate activity pagination" />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-royal/15 bg-royal/8 px-3 py-2 text-[11px] text-royal">
        <span className="inline-flex items-center gap-2 font-medium">
          <TrendingUp aria-hidden className="size-4" />
          {clearedCount <= 0
            ? "Nothing cleared for you yet this week."
            : `${clearedCount} action${clearedCount === 1 ? "" : "s"} cleared for you this week`}
        </span>
        {hours > 0 ? <span>That is {hours} hour{hours === 1 ? "" : "s"} saved.</span> : null}
      </div>
    </div>
  );
}
