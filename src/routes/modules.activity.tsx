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
  ACTIVITY_VIEWS,
  ACTIVITY_VIEW_LABEL,
  awaitingJudgment,
  movements,
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

const EMPTY: Record<ActivityView, { title: string; body: string }> = {
  today: {
    title: "Nothing has been recorded today",
    body: "Rooms write to the shared stream as work happens. An empty day is a truthful result, not a missing feed.",
  },
  needs: {
    title: "Nothing is waiting on your judgment",
    body: "Bounded steps appear here the moment the Conductor proposes one and it needs your authorisation.",
  },
  moved: {
    title: "Nothing has moved yet",
    body: "A movement is recorded when an authorised step is handed to the room that owns it — or when that room refuses it.",
  },
};

export const Route = createFileRoute("/modules/activity")({
  validateSearch: (search: Record<string, unknown>) => ({ view: readActivityView(search) }),
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
  const { view } = Route.useSearch();
  return (
    <WorkspaceGate>{(identity) => <ActivityPage identity={identity} view={view} />}</WorkspaceGate>
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

function ActivityPage({ identity, view }: { identity: WorkspaceIdentity; view: ActivityView }) {
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
              search={{ view: option }}
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
        ) : rows.length === 0 ? (
          <EmptyState title={EMPTY[view].title} body={EMPTY[view].body} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {rows.map((row) => (
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
