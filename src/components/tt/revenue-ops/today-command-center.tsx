import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CircleDollarSign, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { TonePill } from "@/components/tt/primitives";
import {
  readRevenueOpsToday,
  type ActivityStreamActual,
  type RevenueOpsBlocker,
  type RevenueOpsToday,
} from "@/data/revenue-ops/today";
import type { ActivityStream } from "@/data/supabase/activity-targets";
import { cn } from "@/lib/utils";

const STREAM_LABEL: Record<ActivityStream, string> = {
  linkedin_connections: "LinkedIn invitations",
  blog_posts: "Insights posts",
  scout_intros: "Scout intro emails",
};

const STREAM_ROUTE: Record<
  ActivityStream,
  "/settings/outcomes" | "/modules/studio" | "/modules/scout/outreach"
> = {
  linkedin_connections: "/settings/outcomes",
  blog_posts: "/modules/studio",
  scout_intros: "/modules/scout/outreach",
};

function money(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "Not recorded";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function integer(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat().format(value);
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function ProgressBar({ value, max, risk = false }: { value: number; max: number; risk?: boolean }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          risk ? "bg-destructive" : ratio >= 1 ? "bg-success" : "bg-royal",
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function StreamCell({ stream }: { stream: ActivityStreamActual }) {
  const readable = stream.actual !== null;
  const actual = stream.actual ?? 0;
  const target = Math.max(stream.targetCount, 0);
  const behind = readable && target > 0 && actual < target;
  const windowLabel = stream.actualWindow === "this_week" ? "this week" : "today";

  return (
    <Link
      to={STREAM_ROUTE[stream.stream]}
      className="group block min-w-0 border-t border-border pt-3 transition-colors first:border-t-0 first:pt-0 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 sm:first:border-l-0 sm:first:pl-0"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="truncate text-[12px] font-medium text-foreground">{STREAM_LABEL[stream.stream]}</p>
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-royal" />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className={cn("text-lg font-semibold", !readable || behind ? "text-destructive" : "text-foreground")}>
          {readable ? integer(stream.actual) : "Not readable"}
          {readable ? <span className="ml-1 text-xs font-normal text-muted-foreground">/{target}</span> : null}
        </p>
        <span className="text-[10px] text-muted-foreground">{windowLabel}</span>
      </div>
      <div className="mt-2">
        <ProgressBar value={actual} max={target} risk={!readable || behind} />
      </div>
    </Link>
  );
}

function NeedsTai({ today }: { today: RevenueOpsToday }) {
  const debt = today.sources.responseDebt.value;
  const drafts = today.sources.drafts.value;
  const clients = today.sources.clients.value;
  const unreadable = [
    !today.sources.responseDebt.available ? "Comms debt" : null,
    !today.sources.drafts.available ? "Draft queue" : null,
    !today.sources.clients.available ? "Client book" : null,
  ].filter((entry): entry is string => Boolean(entry));

  const replyCount = (debt?.overdueReplies ?? 0) + (debt?.dueTodayReplies ?? 0);
  const followUpCount = (debt?.overdueFollowUps ?? 0) + (debt?.dueTodayFollowUps ?? 0);
  const draftCount = drafts?.totalNeedsReview ?? 0;
  const reviewCount = clients?.reviewsOverdue.length ?? 0;

  const empty =
    unreadable.length === 0 && replyCount + followUpCount + draftCount + reviewCount === 0;

  return (
    <section className="overflow-hidden rounded-lg border border-border/80 bg-card" aria-labelledby="revenue-ops-needs-tai">
      <header className="border-b border-border px-4 py-3">
        <p id="revenue-ops-needs-tai" className="tt-eyebrow">
          Needs Tai
        </p>
      </header>

      {unreadable.length > 0 ? (
        <div className="m-3 rounded-md bg-destructive/8 p-3 text-xs text-destructive">
          Cannot confirm the whole queue: {unreadable.join(", ")}{" "}
          {unreadable.length === 1 ? "is" : "are"} not readable.
        </div>
      ) : empty ? (
        <div className="m-3 rounded-md bg-success/8 p-3 text-xs text-success">
          Nothing needs your hand right now.
        </div>
      ) : (
        <div className="divide-y divide-border">
          <Link
            to="/modules/comms/queue"
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/60"
          >
            <TonePill
              tone={!debt ? "risk" : replyCount > 0 ? "risk" : "neutral"}
              className="min-w-8 justify-center px-2"
            >
              {debt ? replyCount + followUpCount : "?"}
            </TonePill>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Replies and follow-ups</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {debt
                  ? `${replyCount} reply owed, ${followUpCount} follow-up due.`
                  : "Comms debt is not readable."}
              </p>
            </div>
          </Link>

          <Link
            to="/modules/scout/outreach"
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/60"
          >
            <TonePill
              tone={!drafts ? "risk" : draftCount > 0 ? "caution" : "neutral"}
              className="min-w-8 justify-center px-2"
            >
              {drafts ? draftCount : "?"}
            </TonePill>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Outreach approvals</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {drafts
                  ? `${drafts.scoutNeedsReview} Scout, ${drafts.followUpNeedsReview} follow-up, ${drafts.warmIntroNeedsReview} warm intro.`
                  : "Draft queue not readable."}
              </p>
            </div>
          </Link>

          <Link
            to="/modules/clients"
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/60"
          >
            <TonePill
              tone={!clients ? "risk" : reviewCount > 0 ? "risk" : "neutral"}
              className="min-w-8 justify-center px-2"
            >
              {clients ? reviewCount : "?"}
            </TonePill>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Client protection</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {clients
                  ? `${reviewCount} overdue review, ${clients.renewalsSoon.length} renewal inside 30 days.`
                  : "Client book is not readable."}
              </p>
            </div>
          </Link>
        </div>
      )}
      <Link
        to="/modules/comms/queue"
        className="block border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        View all queues →
      </Link>
    </section>
  );
}

function BlockerList({ blockers }: { blockers: RevenueOpsBlocker[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/80 bg-card" aria-labelledby="revenue-ops-blockers">
      <header className="border-b border-border px-4 py-3">
        <p id="revenue-ops-blockers" className="tt-eyebrow">
          Captain watch
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">What is slowing the path to revenue</p>
      </header>

      {blockers.length === 0 ? (
        <div className="m-3 rounded-md bg-success/8 p-3 text-xs text-success">
          No blockers detected from the ledgers Pulse can read.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {blockers.slice(0, 4).map((blocker, index) => (
            <Link
              key={blocker.id}
              to={blocker.route}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 transition-colors hover:bg-secondary/60"
            >
              <span className="grid size-6 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <p className="truncate text-[13px] font-medium text-foreground">{blocker.title}</p>
                  <TonePill
                    tone={blocker.severity === "risk" ? "risk" : "caution"}
                    className="px-2 py-0.5 text-[9px]"
                  >
                    {blocker.severity}
                  </TonePill>
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                  {blocker.detail}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
      {blockers.length > 4 ? (
        <Link
          to="/settings/outcomes"
          className="block border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          View all {blockers.length} items →
        </Link>
      ) : null}
    </section>
  );
}

function RecentMovement({ today }: { today: RevenueOpsToday }) {
  const recent = today.sources.recent.value ?? [];

  return (
    <section className="space-y-4" aria-labelledby="revenue-ops-recent">
      <div>
        <p className="tt-eyebrow">Today and latest</p>
        <h3 id="revenue-ops-recent" className="mt-2 text-lg font-semibold text-foreground">
          Recent movement.
        </h3>
      </div>
      {recent.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          No recent suite activity is readable yet.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {recent.slice(0, 5).map((event) => (
            <div key={event.id} className="p-4">
              <p className="text-sm text-foreground">{event.summary || event.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.subject.label ?? event.subject.type} · {timeLabel(event.occurredAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Dashboard({
  today,
  signalField,
  signalSummary,
}: {
  today: RevenueOpsToday;
  signalField: ReactNode;
  signalSummary: ReactNode;
}) {
  const clients = today.sources.clients.value;
  const activity = today.sources.activityActuals.value;

  const currentMrr = clients?.currentMrrCents ?? null;
  const targetMrr = clients?.targetMrrCents ?? null;
  const gap = clients?.gapCents ?? null;
  const targetKnown = typeof targetMrr === "number";
  const mrrRatio = targetKnown && targetMrr > 0 && currentMrr !== null ? currentMrr / targetMrr : 0;

  return (
    <section className="space-y-6" aria-labelledby="revenue-ops-title">
      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CircleDollarSign className="size-4 text-royal" />
              <p className="tt-eyebrow" id="revenue-ops-title">
                Revenue ops
              </p>
              {!today.sources.clients.available ? (
                <TonePill tone="risk">ledger unreadable</TonePill>
              ) : clients && clients.clientsWithoutMrr.length > 0 ? (
                <TonePill tone="caution">record needs cleanup</TonePill>
              ) : (
                <TonePill tone="good">ledger clean</TonePill>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-end">
              <div>
                <p className="text-3xl font-semibold text-foreground sm:text-4xl">
                  {money(currentMrr)}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    / {money(targetMrr)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {!today.sources.clients.available
                    ? "Revenue ledger is not readable. Goal math is paused until this source returns."
                    : gap === null
                      ? "Set the monthly revenue target to make the gap visible."
                      : `${money(gap)} left to close`}
                </p>
              </div>
              <div className="space-y-2">
                <ProgressBar value={Math.round(mrrRatio * 100)} max={100} />
                <p className="text-[11px] text-muted-foreground">
                  {today.sources.clients.available
                    ? `${clients?.runClients ?? 0} Run clients recorded`
                    : "Revenue source unavailable"}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            {activity ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {activity.streams.map((stream) => (
                  <StreamCell key={stream.stream} stream={stream} />
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-destructive/8 p-3 text-xs text-destructive">
                Activity actuals are not readable.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <aside className="order-1 space-y-4 xl:order-none xl:col-start-2 xl:row-start-1" aria-label="Revenue action queues">
          <NeedsTai today={today} />
          <BlockerList blockers={today.blockers} />
        </aside>

        <div className="order-2 min-w-0 xl:order-none xl:col-start-1 xl:row-start-1">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <RecentMovement today={today} />
            <aside className="border-l border-border pl-4">
              <p className="tt-eyebrow">Operating notes</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Clear replies first, then approve or reject drafted outreach. Close the day by naming tomorrow&apos;s single best move.
              </p>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Read at {timeLabel(today.readAt)} on {dateLabel(today.readAt)}.
              </p>
            </aside>
          </div>
        </div>

        <div className="order-3 min-w-0 xl:order-none xl:col-start-1 xl:row-start-2">
          {signalField}
        </div>

        <aside className="order-4 xl:order-none xl:col-start-2 xl:row-start-2" aria-label="Signal summary">
          {signalSummary}
        </aside>
      </div>
    </section>
  );
}

export function TodayCommandCenter({
  organizationId,
  signalField,
  signalSummary,
}: {
  organizationId: string;
  signalField: ReactNode;
  signalSummary: ReactNode;
}) {
  const today = useQuery({
    queryKey: ["revenue-ops", "today", organizationId],
    queryFn: () => readRevenueOpsToday(organizationId),
    refetchInterval: 60_000,
  });

  if (today.isLoading) {
    return (
      <div className="space-y-6">
        <section className="tt-surface p-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" />
            Reading today's revenue ledgers.
          </div>
        </section>
        {signalField}
        {signalSummary}
      </div>
    );
  }

  if (today.isError || !today.data) {
    return (
      <div className="space-y-6">
        <section className="tt-surface border-destructive/25 bg-destructive/8 p-6">
          <p className="text-sm font-medium text-destructive">
            Revenue Ops could not read today's ledgers.
          </p>
          <p className="mt-1 text-xs text-destructive/80">
            {(today.error as Error | undefined)?.message ?? "No detail returned."}
          </p>
        </section>
        {signalField}
        {signalSummary}
      </div>
    );
  }

  return (
    <Dashboard today={today.data} signalField={signalField} signalSummary={signalSummary} />
  );
}
