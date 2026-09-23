import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { readAgentRuns } from "@/data/steward/agent-runs-read";
import { scoutService } from "@/data/supabase/scout-service";
import { stewardTasks } from "@/data/supabase/steward-tasks";
import { supabase } from "@/integrations/trust-tai/supabase";
import { buildScoutCards, filterScoutCards, pageOf, type ScoutFilters } from "@/domain/steward-scouts";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Scouts · Trust Tai OS";
const DESCRIPTION = "Every Scout company with its people, tasks and the AI teammate's progress.";

export const Route = createFileRoute("/modules/steward/scouts")({
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
          <Scouts identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  ),
});

const RUN_LABEL: Record<string, string> = {
  queued: "Queued", working: "Running", needs_approval: "Needs approval", blocked: "Blocked",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

async function peopleCounts(organizationId: string): Promise<Map<string, number> | null> {
  const { data, error } = await supabase.from("scout_people").select("prospect_id").eq("organization_id", organizationId).limit(5000);
  if (error) return null;
  const m = new Map<string, number>();
  for (const r of (data ?? []) as { prospect_id: string }[]) m.set(r.prospect_id, (m.get(r.prospect_id) ?? 0) + 1);
  return m;
}

function Scouts({ identity }: { identity: WorkspaceIdentity }) {
  const [filters, setFilters] = useState<ScoutFilters>({ stage: "all", openOnly: false, agent: "all" });
  const [page, setPage] = useState(1);
  const read = useQuery({
    queryKey: ["steward", "scouts", identity.organizationId],
    queryFn: async () => {
      const [prospects, tasks, runs, counts] = await Promise.all([
        scoutService.list(identity.organizationId),
        stewardTasks.list(identity.organizationId).catch(() => []),
        readAgentRuns(identity.organizationId).catch(() => ({ available: false, runs: [] })),
        peopleCounts(identity.organizationId),
      ]);
      return buildScoutCards({
        prospects: prospects.map((c) => ({ id: c.prospect.id, name: c.prospect.name, status: c.prospect.status })),
        tasks,
        runs: runs.available ? runs.runs : null,
        peopleCounts: counts,
      });
    },
  });
  const all = read.data ?? [];
  const stages = useMemo(() => Array.from(new Set(all.map((c) => c.stage))).sort(), [all]);
  const shown = filterScoutCards(all, filters);
  const { items, pages } = pageOf(shown, page);
  const set = (f: Partial<ScoutFilters>) => { setFilters({ ...filters, ...f }); setPage(1); };
  const select = "ml-1 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Steward</h1>
        <p className="text-sm text-muted-foreground">{DESCRIPTION}</p>
      </header>
      <StewardTabs active="scouts" />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <label>Stage
          <select className={select} value={filters.stage} onChange={(e) => set({ stage: e.target.value })}>
            <option value="all">All</option>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>AI
          <select className={select} value={filters.agent} onChange={(e) => set({ agent: e.target.value as ScoutFilters["agent"] })}>
            <option value="all">Any</option>
            <option value="has_run">Has AI work</option>
            <option value="no_run">No AI work</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filters.openOnly} onChange={(e) => set({ openOnly: e.target.checked })} /> Open tasks only
        </label>
        {read.isSuccess && <span className="text-xs">{shown.length} of {all.length} companies</span>}
      </div>

      {read.isPending && <p className="text-sm text-muted-foreground">Loading Scout companies…</p>}
      {read.isError && <p role="alert" className="text-sm text-destructive">Scout companies can't be read right now. Nothing is shown rather than guessing.</p>}
      {read.isSuccess && shown.length === 0 && <p className="text-sm text-muted-foreground">No companies match these filters.</p>}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <li key={c.prospectId}>
            <Link
              to="/modules/scout/prospects/$prospectId"
              params={{ prospectId: c.prospectId }}
              search={{ tab: "people" } as never}
              className="block h-full rounded-2xl border border-border bg-card p-5 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-base font-medium text-foreground">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.stage}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">People</dt><dd className="text-foreground">{c.people ?? "Not recorded"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Open</dt><dd className="text-foreground">{c.open}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Done</dt><dd className="text-foreground">{c.done}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Needs approval</dt><dd className="text-foreground">{c.needsApproval}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                AI: {c.latestRun === "unknown" ? "Not recorded" : c.latestRun ? `${RUN_LABEL[c.latestRun.status] ?? c.latestRun.status} · ${new Date(c.latestRun.at).toLocaleDateString()}` : "No AI work yet"}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav aria-label="Scout pages" className="flex items-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-full border border-border px-3 py-1 disabled:opacity-50">Previous</button>
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-full border border-border px-3 py-1 disabled:opacity-50">Next</button>
        </nav>
      )}
    </div>
  );
}
