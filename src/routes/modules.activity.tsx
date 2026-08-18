/**
 * The activity view, what the Conductor rail states, at full length.
 *
 * Three readings of the same suite: what was recorded today, what is waiting
 * on Tai's judgment, and what has actually moved between rooms. This surface
 * changes nothing. Every row points back at the room that owns the work.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_VIEWS,
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABEL,
  ACTIVITY_VIEW_LABEL,
  awaitingJudgment,
  filterActivity,
  readActivityKind,
  readActivityQuery,
  readActivityDate,
  hasRange,
  orderRange,
  recordedActivity,
  movements,
  pageActivity,
  readActivityPage,
  readActivityView,
  todaysActivity,
  type ActivityKind,
  type ActivityRange,
  type ActivityRow,
  type ActivityView,
} from "@/data/conductor/activity-view";
import { loadControlledActions, loadReceipts } from "@/data/supabase/conductor-control-service";
import { supabaseActivity } from "@/data/supabase/activities";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Activity · Today, Needs Tai, Recently moved · Trust Tai OS";
const DESCRIPTION =
  "Everything the suite recorded today, every bounded step still waiting on a person, and every handover that actually happened.";

const EMPTY: Record<ActivityView, { title: string; belongsHere: string; whyItMatters: string }> = {
  today: {
    title: "Nothing has been recorded today",
    belongsHere: "Every event the rooms wrote to the shared stream today.",
    whyItMatters:
      "An empty day is a truthful result, not a missing feed. Rooms record as work happens.",
  },
  needs: {
    title: "Nothing is waiting on your judgment",
    belongsHere: "Bounded steps the Conductor has proposed but no one has settled.",
    whyItMatters:
      "A step appears the moment it needs your authorisation, and leaves as soon as you decide.",
  },
  moved: {
    title: "Nothing has moved yet",
    belongsHere: "Every handover between rooms, including refusals and failures.",
    whyItMatters:
      "A movement is recorded when an authorised step reaches the room that owns it.",
  },
};

export const Route = createFileRoute("/modules/activity")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: readActivityView(search),
    page: readActivityPage(search),
    kind: readActivityKind(search),
    q: readActivityQuery(search),
    from: readActivityDate(search, "from"),
    to: readActivityDate(search, "to"),
  }),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ActivityRoute,
});

function ActivityRoute() {
  const { view, page, kind, q, from, to } = Route.useSearch();
  return (
    <WorkspaceGate
      preview={{
        room: "The activity view",
        purpose:
          "Activity is a read of your organization's own history, what the rooms recorded today, what is waiting on your judgment, and what actually moved between rooms.",
        unavailable: [
          "Today's recorded events across every room.",
          "Bounded steps still awaiting your authorisation.",
          "Handovers between rooms, including refusals and failures.",
        ],
        returnTo: "/modules/activity",
      }}
    >
      {(identity) => (
        <ActivityPage
          identity={identity}
          view={view}
          page={page}
          kind={kind}
          query={q}
          range={{ from, to }}
        />
      )}
    </WorkspaceGate>
  );
}

function when(at: string | null): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ActivityPage({
  identity,
  view,
  page,
  kind,
  query,
  range,
}: {
  identity: WorkspaceIdentity;
  view: ActivityView;
  page: number;
  kind: ActivityKind;
  query: string;
  range: ActivityRange;
}) {
  const navigate = Route.useNavigate();
  const events = useQuery({
    queryKey: ["activity-stream", identity.organizationId],
    queryFn: () => supabaseActivity.list({ organizationId: identity.organizationId, limit: 200 }),
    staleTime: 15_000,
  });

  const control = useQuery({
    queryKey: ["activity-control", identity.organizationId],
    queryFn: async () => ({
      actions: await loadControlledActions(identity.organizationId),
      receipts: await loadReceipts(identity.organizationId),
    }),
    staleTime: 15_000,
  });

  const actions = control.data?.actions ?? [];
  const window = orderRange(range);
  const windowed = hasRange(window);
  /* A window is a deliberate widening: Today reads the whole stream inside it. */
  const rows: ActivityRow[] =
    view === "today"
      ? windowed
        ? recordedActivity(events.data ?? [])
        : todaysActivity(events.data ?? [], new Date())
      : view === "needs"
        ? awaitingJudgment(actions)
        : movements({ receipts: control.data?.receipts ?? [], actions });

  const paged = pageActivity(filterActivity(rows, { query, kind, range: window }), page);

  const loading = view === "today" ? events.isPending : control.isPending;
  const failed = view === "today" ? events.isError : control.isError;

  return (
    <AppShell identity={identity}>
      <div className="max-w-[900px] space-y-6">
        <header>
          <p className="tt-eyebrow">Activity</p>
          <h1 className="tt-display mt-2 text-[26px] text-foreground sm:text-[30px]">
            {ACTIVITY_VIEW_LABEL[view]}
          </h1>
          <p className="mt-2 max-w-reading text-sm text-muted-foreground">
            Read from the same sources the Conductor rail counts. This page records nothing and
            changes nothing.
          </p>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Activity views">
          {ACTIVITY_VIEWS.map((option) => (
            <Link
              key={option}
              to="/modules/activity"
              search={{ view: option, page: 1, kind, q: query, from: range.from, to: range.to }}
              className="rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted-foreground data-[status=active]:border-royal data-[status=active]:text-royal"
              activeOptions={{ includeSearch: true }}
              activeProps={{ "aria-current": "page" }}
            >
              {ACTIVITY_VIEW_LABEL[option]}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <label className="min-w-[220px] flex-1 sm:max-w-[320px]">
            <span className="sr-only">Search activity</span>
            <input
              type="search"
              value={query}
              placeholder="Search activity, e.g. completed, reassigned, a task title"
              onChange={(event) =>
                navigate({
                  search: (prev) => ({ ...prev, q: event.target.value, page: 1 }),
                  replace: true,
                })
              }
              className="h-10 w-full rounded-full border border-border bg-card px-4 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by change">
            {ACTIVITY_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, kind: option, page: 1 }), replace: true })
                }
                className={
                  kind === option
                    ? "rounded-full border border-royal px-3.5 py-1.5 text-[13px] text-royal"
                    : "rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted-foreground"
                }
              >
                {ACTIVITY_KIND_LABEL[option]}
              </button>
            ))}
          </div>
        </div>

        <div
          className="flex flex-wrap items-end gap-3"
          role="group"
          aria-label="Narrow to a date window"
        >
          <label className="text-[12.5px] text-muted-foreground">
            <span className="block pb-1">From</span>
            <input
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(event) =>
                navigate({
                  search: (prev) => ({ ...prev, from: event.target.value, page: 1 }),
                  replace: true,
                })
              }
              className="h-10 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="text-[12.5px] text-muted-foreground">
            <span className="block pb-1">To</span>
            <input
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(event) =>
                navigate({
                  search: (prev) => ({ ...prev, to: event.target.value, page: 1 }),
                  replace: true,
                })
              }
              className="h-10 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {windowed ? (
            <button
              type="button"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, from: "", to: "", page: 1 }),
                  replace: true,
                })
              }
              className="h-10 rounded-full border border-border px-3.5 text-[13px] text-royal"
            >
              Clear dates
            </button>
          ) : null}
          {windowed && view === "today" ? (
            <p className="w-full text-[12.5px] text-muted-foreground">
              Reading the whole recorded stream inside this window, not only today.
            </p>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Reading the suite.</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">
            That history could not be read just now. Nothing was changed; try again.
          </p>
        ) : paged.total === 0 ? (
          query.trim() || kind !== "all" || windowed ? (
            <EmptyState
              title="Nothing matches that search"
              belongsHere="Only events already recorded in this view can match."
              whyItMatters="Clear the search, the dates, or choose Everything to see the full history again."
            />
          ) : (
            <EmptyState {...EMPTY[view]} />
          )
        ) : (
          <>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {paged.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5">
                {row.task ? (
                  <Link
                    to="/modules/steward/tasks"
                    search={{ task: row.task.key, at: row.at ?? "" }}
                    className="min-w-0 flex-1 text-[14px] text-foreground underline decoration-border underline-offset-4 hover:decoration-royal"
                    title={`Open ${row.task.title} as it stood when this was recorded`}
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 text-[14px] text-foreground">{row.label}</span>
                )}
                <span className="tt-eyebrow">{row.roomLabel}</span>
                <span className="text-[12.5px] text-muted-foreground">{row.standing}</span>
                <span className="w-[128px] text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {when(row.at)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
              Showing {paged.rows.length} of {paged.total}
            </p>
            {paged.hasMore ? (
              <Link
                to="/modules/activity"
                search={{
                  view,
                  page: paged.page + 1,
                  kind,
                  q: query,
                  from: range.from,
                  to: range.to,
                }}
                replace
                className="rounded-full border border-border px-3.5 py-1.5 text-[13px] text-royal"
              >
                Show {Math.min(ACTIVITY_PAGE_SIZE, paged.total - paged.rows.length)} more
              </Link>
            ) : null}
          </div>
          </>
        )}

        <p className="text-[13px] text-muted-foreground">
          <Link to="/modules/conductor" className="text-royal underline underline-offset-4">
            Back to the Conductor
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
