import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  MailCheck,
  RefreshCw,
  Send,
  ShieldAlert,
  UserCheck,
} from "lucide-react";

import { MetaPill, SectionHeading, TonePill, TTButton } from "@/components/tt/primitives";
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

function SourceStatus({ today }: { today: RevenueOpsToday }) {
  const entries = [
    ["Activity targets", today.sources.activityTargets],
    ["Activity actuals", today.sources.activityActuals],
    ["Weekly targets", today.sources.weeklyTargets],
    ["Scoreboard", today.sources.weeklyScoreboard],
    ["Revenue", today.sources.clients],
    ["Comms", today.sources.responseDebt],
    ["Drafts", today.sources.drafts],
    ["Scout", today.sources.prospects],
    ["Studio", today.sources.content],
    ["Movement", today.sources.recent],
  ] as const;
  const missing = entries.filter(([, source]) => !source.available);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {missing.length === 0 ? (
        <TonePill tone="good" dot>
          All ledgers readable
        </TonePill>
      ) : (
        <TonePill tone="risk" dot>
          {missing.length} source{missing.length === 1 ? "" : "s"} unreadable
        </TonePill>
      )}
      {entries.map(([label, source]) => (
        <MetaPill
          key={label}
          className={source.available ? "" : "border-destructive/25 text-destructive"}
        >
          {label}
        </MetaPill>
      ))}
    </div>
  );
}

function StreamCell({ stream }: { stream: ActivityStreamActual }) {
  const actual = stream.actual ?? 0;
  const target = Math.max(stream.targetCount, 0);
  const behind = stream.actual !== null && target > 0 && actual < target;
  const windowLabel = stream.actualWindow === "this_week" ? "this week" : "today";

  return (
    <Link
      to={STREAM_ROUTE[stream.stream]}
      className="group block rounded-lg border border-border bg-card/70 p-4 transition-colors hover:border-royal/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{STREAM_LABEL[stream.stream]}</p>
          <p className="mt-1 text-xs text-muted-foreground">{stream.source}</p>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-royal" />
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold text-foreground">
          {integer(stream.actual)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">/{target}</span>
        </p>
        <TonePill tone={behind ? "caution" : "good"}>{windowLabel}</TonePill>
      </div>
      <div className="mt-3">
        <ProgressBar value={actual} max={target} />
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
    <section className="space-y-4" aria-labelledby="revenue-ops-needs-tai">
      <div>
        <p className="tt-eyebrow">Needs Tai</p>
        <h3 id="revenue-ops-needs-tai" className="mt-2 text-lg font-semibold text-foreground">
          The queue you should see first.
        </h3>
      </div>

      {unreadable.length > 0 ? (
        <div className="rounded-lg border border-destructive/25 bg-destructive/8 p-4 text-sm text-destructive">
          Cannot confirm the whole queue: {unreadable.join(", ")}{" "}
          {unreadable.length === 1 ? "is" : "are"} not readable.
        </div>
      ) : empty ? (
        <div className="rounded-lg border border-success/20 bg-success/8 p-4 text-sm text-success">
          Nothing needs your hand right now.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          <Link
            to="/modules/comms/queue"
            className="grid gap-2 p-4 transition-colors hover:bg-secondary/60 sm:grid-cols-[auto_1fr_auto] sm:items-center"
          >
            <MailCheck className="size-5 text-royal" />
            <div>
              <p className="text-sm font-medium text-foreground">Replies and follow-ups</p>
              <p className="text-xs text-muted-foreground">
                {debt
                  ? `${replyCount} reply owed, ${followUpCount} follow-up due.`
                  : "Comms debt is not readable."}
              </p>
            </div>
            <TonePill tone={!debt ? "risk" : replyCount > 0 ? "risk" : "caution"}>
              {debt ? replyCount + followUpCount : "source"}
            </TonePill>
          </Link>

          <Link
            to="/modules/scout/outreach"
            className="grid gap-2 p-4 transition-colors hover:bg-secondary/60 sm:grid-cols-[auto_1fr_auto] sm:items-center"
          >
            <Send className="size-5 text-royal" />
            <div>
              <p className="text-sm font-medium text-foreground">Outreach approvals</p>
              <p className="text-xs text-muted-foreground">
                {drafts
                  ? `${drafts.scoutNeedsReview} Scout, ${drafts.followUpNeedsReview} follow-up, ${drafts.warmIntroNeedsReview} warm intro.`
                  : "Draft queue not readable."}
              </p>
            </div>
            <TonePill tone={!drafts ? "risk" : draftCount > 0 ? "caution" : "good"}>
              {drafts ? draftCount : "source"}
            </TonePill>
          </Link>

          <Link
            to="/modules/clients"
            className="grid gap-2 p-4 transition-colors hover:bg-secondary/60 sm:grid-cols-[auto_1fr_auto] sm:items-center"
          >
            <UserCheck className="size-5 text-royal" />
            <div>
              <p className="text-sm font-medium text-foreground">Client protection</p>
              <p className="text-xs text-muted-foreground">
                {clients
                  ? `${reviewCount} overdue review, ${clients.renewalsSoon.length} renewal inside 30 days.`
                  : "Client book is not readable."}
              </p>
            </div>
            <TonePill tone={!clients ? "risk" : reviewCount > 0 ? "risk" : "good"}>
              {clients ? reviewCount : "source"}
            </TonePill>
          </Link>
        </div>
      )}
    </section>
  );
}

function BlockerList({ blockers }: { blockers: RevenueOpsBlocker[] }) {
  return (
    <section className="space-y-4" aria-labelledby="revenue-ops-blockers">
      <div>
        <p className="tt-eyebrow">Captain watch</p>
        <h3 id="revenue-ops-blockers" className="mt-2 text-lg font-semibold text-foreground">
          What is slowing the path to revenue.
        </h3>
      </div>

      {blockers.length === 0 ? (
        <div className="rounded-lg border border-success/20 bg-success/8 p-4 text-sm text-success">
          No blockers detected from the ledgers Pulse can read.
        </div>
      ) : (
        <div className="space-y-3">
          {blockers.slice(0, 6).map((blocker) => (
            <Link
              key={blocker.id}
              to={blocker.route}
              className="grid gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-royal/35 sm:grid-cols-[auto_1fr]"
            >
              {blocker.severity === "risk" ? (
                <ShieldAlert className="mt-0.5 size-5 text-destructive" />
              ) : (
                <AlertTriangle className="mt-0.5 size-5 text-warning" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{blocker.title}</p>
                  <TonePill tone={blocker.severity === "risk" ? "risk" : "caution"}>
                    {blocker.severity}
                  </TonePill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{blocker.detail}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
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

function Dashboard({ today }: { today: RevenueOpsToday }) {
  const clients = today.sources.clients.value;
  const activity = today.sources.activityActuals.value;
  const scoreboard = today.sources.weeklyScoreboard.value;
  const prospects = today.sources.prospects.value;
  const content = today.sources.content.value;
  const drafts = today.sources.drafts.value;

  const currentMrr = clients?.currentMrrCents ?? null;
  const targetMrr = clients?.targetMrrCents ?? null;
  const gap = clients?.gapCents ?? null;
  const targetKnown = typeof targetMrr === "number";
  const mrrRatio = targetKnown && targetMrr > 0 && currentMrr !== null ? currentMrr / targetMrr : 0;

  return (
    <section className="space-y-5" aria-labelledby="revenue-ops-title">
      <SectionHeading
        eyebrow="Revenue Ops"
        title="Today's operating command center"
        description="The path to $21k MRR, read from the ledgers. No source is allowed to disappear into a quiet zero."
        action={<SourceStatus today={today} />}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CircleDollarSign className="size-5 text-royal" />
                  <p className="tt-eyebrow" id="revenue-ops-title">
                    MRR goal
                  </p>
                  {!today.sources.clients.available ? (
                    <TonePill tone="risk">ledger unreadable</TonePill>
                  ) : clients && clients.clientsWithoutMrr.length > 0 ? (
                    <TonePill tone="caution">record needs cleanup</TonePill>
                  ) : (
                    <TonePill tone="good">ledger clean</TonePill>
                  )}
                </div>
                <p className="mt-4 text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
                  {money(currentMrr)}
                  <span className="ml-2 text-base font-normal text-muted-foreground">
                    / {money(targetMrr)}
                  </span>
                </p>
                <p className="mt-3 max-w-reading text-sm text-muted-foreground">
                  {!today.sources.clients.available
                    ? "Revenue ledger is not readable. Goal math is paused until this source returns."
                    : gap === null
                      ? "Set the monthly revenue target to make the gap visible."
                      : `${money(gap)} left to close. ${clients?.runClients ?? 0} Run client${clients?.runClients === 1 ? "" : "s"} recorded out of ${clients?.clientsTotal ?? 0} clients.`}
                </p>
              </div>

              <div className="space-y-3">
                <ProgressBar value={Math.round(mrrRatio * 100)} max={100} />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Weekly first touches</p>
                    <p className="mt-1 font-medium text-foreground">
                      {integer(scoreboard?.firstTouches)} /{" "}
                      {scoreboard?.targets.firstTouchTargetHigh ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Discovery calls</p>
                    <p className="mt-1 font-medium text-foreground">
                      {integer(scoreboard?.discoveryCalls)} /{" "}
                      {scoreboard?.targets.discoveryTargetHigh ?? "-"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {activity ? (
            <div className="grid gap-4 lg:grid-cols-3">
              {activity.streams.map((stream) => (
                <StreamCell key={stream.stream} stream={stream} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-destructive/25 bg-destructive/8 p-4 text-sm text-destructive">
              Activity actuals are not readable.
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Link
              to="/modules/scout"
              search={{ section: "all", fit: "all" }}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-royal/35"
            >
              <p className="text-xs text-muted-foreground">Scout backlog</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {integer(prospects?.unscored)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {today.sources.prospects.available
                  ? `unscored of ${integer(prospects?.total)} prospects`
                  : "Scout ledger is not readable"}
              </p>
            </Link>

            <Link
              to="/modules/studio"
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-royal/35"
            >
              <p className="text-xs text-muted-foreground">Studio content</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {integer(content?.publishedPosts)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {today.sources.content.available
                  ? `published · ${integer(content?.exceptionItems)} exceptions`
                  : "Studio ledger is not readable"}
              </p>
            </Link>

            <Link
              to="/modules/scout/outreach"
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-royal/35"
            >
              <p className="text-xs text-muted-foreground">Drafted today</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {integer(drafts?.scoutCreatedToday)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {today.sources.drafts.available
                  ? "Scout intro drafts, approval still human"
                  : "Draft ledger is not readable"}
              </p>
            </Link>
          </div>
        </div>

        <div className="space-y-6">
          <NeedsTai today={today} />
          <BlockerList blockers={today.blockers} />
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <RecentMovement today={today} />
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-royal" />
            <p className="text-sm font-medium text-foreground">Operating notes</p>
          </div>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Start of day should clear replies first, then approve or reject the drafted outreach,
              then check whether content and LinkedIn are behind target.
            </p>
            <p>
              End of day should close response debt to zero and name the single best action for
              tomorrow.
            </p>
            <p className="text-xs">
              Read at {timeLabel(today.readAt)} on {dateLabel(today.readAt)}.
            </p>
          </div>
          {today.blockers.length > 0 ? (
            <TTButton asChild variant="secondary" size="sm" className="w-full">
              <Link to={today.blockers[0]!.route}>
                Open top blocker
                <ArrowUpRight aria-hidden />
              </Link>
            </TTButton>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/8 px-3 py-2 text-sm text-success">
              <CheckCircle2 className="size-4" />
              No top blocker
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function TodayCommandCenter({ organizationId }: { organizationId: string }) {
  const today = useQuery({
    queryKey: ["revenue-ops", "today", organizationId],
    queryFn: () => readRevenueOpsToday(organizationId),
    refetchInterval: 60_000,
  });

  if (today.isLoading) {
    return (
      <section className="tt-surface p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          Reading today's revenue ledgers.
        </div>
      </section>
    );
  }

  if (today.isError || !today.data) {
    return (
      <section className="tt-surface border-destructive/25 bg-destructive/8 p-6">
        <p className="text-sm font-medium text-destructive">
          Revenue Ops could not read today's ledgers.
        </p>
        <p className="mt-1 text-xs text-destructive/80">
          {(today.error as Error | undefined)?.message ?? "No detail returned."}
        </p>
      </section>
    );
  }

  return <Dashboard today={today.data} />;
}
