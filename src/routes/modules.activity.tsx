/**
 * The activity view — what the Conductor rail states, at full length.
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
  ACTIVITY_VIEW_LABEL,
  awaitingJudgment,
  movements,
  pageActivity,
  readActivityPage,
  readActivityView,
  todaysActivity,
  type ActivityRow,
  type ActivityView,
} from "@/data/conductor/activity-view";
import { loadControlledActions, loadReceipts } from "@/data/supabase/conductor-control-service";
import { supabaseActivity } from "@/data/supabase/activities";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Activity — Today, Needs Tai, Recently moved — Trust Tai OS";
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
  const { view, page } = Route.useSearch();
  return (
    <WorkspaceGate
      preview={{
        room: "The activity view",
        purpose:
          "Activity is a read of your organization's own history — what the rooms recorded today, what is waiting on your judgment, and what actually moved between rooms.",
        unavailable: [
          "Today's recorded events across every room.",
          "Bounded steps still awaiting your authorisation.",
          "Handovers between rooms, including refusals and failures.",
        ],
        returnTo: "/modules/activity",
      }}
    >
      {(identity) => <ActivityPage identity={identity} view={view} page={page} />}
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
}: {
  identity: WorkspaceIdentity;
  view: ActivityView;
  page: number;
}) {
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
  const rows: ActivityRow[] =
    view === "today"
      ? todaysActivity(events.data ?? [], new Date())
      : view === "needs"
        ? awaitingJudgment(actions)
        : movements({ receipts: control.data?.receipts ?? [], actions });

  const paged = pageActivity(rows, page);

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
              search={{ view: option, page: 1 }}
              className="rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted-foreground data-[status=active]:border-royal data-[status=active]:text-royal"
              activeOptions={{ includeSearch: true }}
              activeProps={{ "aria-current": "page" }}
            >
              {ACTIVITY_VIEW_LABEL[option]}
            </Link>
          ))}
        </nav>

        {loading ? (
          <p className="text-sm text-muted-foreground">Reading the suite.</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">
            That history could not be read just now. Nothing was changed; try again.
          </p>
        ) : paged.total === 0 ? (
          <EmptyState {...EMPTY[view]} />
        ) : (
          <>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {paged.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5">
                <span className="min-w-0 flex-1 text-[14px] text-foreground">{row.label}</span>
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
                search={{ view, page: paged.page + 1 }}
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
