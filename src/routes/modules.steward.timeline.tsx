import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, Circle, CircleDot, ShieldAlert, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { TTButton } from "@/components/tt/primitives";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { readTaskTimelines } from "@/data/steward/agent-runs-read";
import { loadWorkspacePeople } from "@/data/daily-workspace";
import {
  AI_ACTOR,
  filterTimelines,
  STAGE_LABEL,
  type TimelineStage,
} from "@/domain/steward-task-timeline";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Timeline · Trust Tai OS";
const DESCRIPTION = "Every task's path from pending to done, with dates and who worked on it.";
const PAGE = 10;

export const Route = createFileRoute("/modules/steward/timeline")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <Timeline identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  ),
});

const ICON: Record<TimelineStage, typeof Circle> = {
  pending: Circle,
  in_progress: CircleDot,
  needs_approval: ShieldAlert,
  completed: CheckCircle2,
  failed: XCircle,
};

function when(at: string | null) {
  if (!at) return "Not recorded";
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Timeline({ identity }: { identity: WorkspaceIdentity }) {
  const [stage, setStage] = useState<TimelineStage | "all">("all");
  const [owner, setOwner] = useState<string>("all");
  const [page, setPage] = useState(1);
  const read = useQuery({
    queryKey: ["steward", "timeline", identity.organizationId],
    queryFn: async () => {
      // A names failure must not hide task history; unknown names show as "Unknown".
      const people = await loadWorkspacePeople(identity.organizationId)
        .then((r) => r.people)
        .catch(() => []);
      return readTaskTimelines(
        identity.organizationId,
        new Map(people.map((p) => [p.userId, p.displayName])),
      );
    },
  });
  const all = read.data?.timelines ?? [];
  const owners = useMemo(() => Array.from(new Set(all.map((t) => t.ownerLabel))).sort(), [all]);
  const shown = filterTimelines(all, { stage, owner });
  const pageItems = shown.slice(0, page * PAGE);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Steward</h1>
        <p className="text-sm text-muted-foreground">{DESCRIPTION}</p>
      </header>
      <StewardTabs active="timeline" />

      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-muted-foreground">
          Status{" "}
          <select
            className="ml-1 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            value={stage}
            onChange={(e) => { setStage(e.target.value as TimelineStage | "all"); setPage(1); }}
          >
            <option value="all">All</option>
            {(Object.keys(STAGE_LABEL) as TimelineStage[]).map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted-foreground">
          Owner{" "}
          <select
            className="ml-1 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            value={owner}
            onChange={(e) => { setOwner(e.target.value); setPage(1); }}
          >
            <option value="all">Everyone</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <span className="self-center text-xs text-muted-foreground">
          {read.isSuccess ? `${shown.length} of ${all.length} tasks` : ""}
        </span>
      </div>

      {read.isPending && <p className="text-sm text-muted-foreground">Loading task history…</p>}
      {read.isError && (
        <p role="alert" className="text-sm text-destructive">
          Task history could not be read right now. Nothing is shown rather than guessing.
        </p>
      )}
      {read.data && !read.data.runsAvailable && (
        <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
          AI run history is not stored in this workspace yet, so AI steps may show as “Not recorded”.
        </p>
      )}
      {read.isSuccess && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">No tasks match these filters.</p>
      )}

      <ul className="space-y-4">
        {pageItems.map((t) => (
          <li key={t.taskId} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-medium text-foreground">{t.title}</h2>
              <span className="text-xs text-muted-foreground">
                {STAGE_LABEL[t.current]} · {t.ownerLabel}
              </span>
            </div>
            <ol className="mt-4 space-y-3 border-l border-border pl-4">
              {t.steps.map((s, i) => {
                const Icon = ICON[s.stage];
                return (
                  <li key={i} className="relative">
                    <Icon aria-hidden className="absolute -left-[1.45rem] top-0.5 size-4 bg-card text-muted-foreground" />
                    <p className="text-sm text-foreground">
                      {STAGE_LABEL[s.stage]}
                      <span className="text-muted-foreground"> · {when(s.at)}</span>
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {s.actor === AI_ACTOR && <Bot aria-hidden className="size-3" />}
                      {s.actor}
                      {s.note ? ` · ${s.note}` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ul>
      {pageItems.length < shown.length && (
        <TTButton variant="secondary" onClick={() => setPage((p) => p + 1)}>
          Show more ({shown.length - pageItems.length} left)
        </TTButton>
      )}
    </div>
  );
}
