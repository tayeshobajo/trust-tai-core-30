import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { useMemo, useState } from "react";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { FitFilters, ProspectBoard, type FitFilter } from "@/components/tt/prospect-board";
import { ScoutTabs } from "@/components/tt/scout-tabs";
import { ProspectDrawer } from "@/components/tt/prospect-drawer";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { scoutService } from "@/data/supabase/scout-service";
import { SCOUT_STARTER_PROMPTS, type ProspectCandidate } from "@/domain/scout";
import type { FitLight } from "@/domain/scout-fit";
import { looksLikeWebsite } from "@/lib/website-url";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { formatChecked } from "@/components/tt/fit-light";

const TITLE = "Scout — Trust Tai OS";
const DESCRIPTION =
  "A scouting board of companies with conservative ICP fit scoring, the evidence behind each read, and one clear next move.";

export const Route = createFileRoute("/modules/scout/")({
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
  component: ScoutRoute,
});

function ScoutRoute() {
  const { section } = Route.useSearch();
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Scout identity={identity} tab={section} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

const LIGHT_RANK: Record<FitLight, number> = { green: 3, yellow: 2, neutral: 1, red: 0 };

function Scout({ identity, tab }: { identity: WorkspaceIdentity; tab: Tab }) {
  const { organizationId, userId } = identity;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FitFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const isWebsite = looksLikeWebsite(query);

  const icp = useQuery({
    queryKey: ["scout", "icp", organizationId],
    queryFn: () => scoutService.icp(organizationId),
  });

  const saved = useQuery({
    queryKey: ["scout", "prospects", organizationId],
    queryFn: () => scoutService.list(organizationId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] });

  const search = useMutation({
    mutationFn: (text: string) => scoutService.search({ organizationId, userId, query: text }),
    onSuccess: refresh,
  });

  const research = useMutation({
    mutationFn: (websiteUrl: string) =>
      scoutService.research({ organizationId, userId, websiteUrl }),
    onSuccess: async (found) => {
      setSelectedId(found.candidate.prospect.id);
      await refresh();
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "qualified" | "passed" }) =>
      scoutService.setStatus(id, status, { organizationId, userId }),
    onSuccess: refresh,
  });

  const override = useMutation({
    mutationFn: ({ id, light }: { id: string; light: FitLight | null }) =>
      scoutService.overrideFit(id, light, { organizationId, userId }),
    onSuccess: refresh,
  });

  const all = useMemo(() => saved.data ?? [], [saved.data]);

  const board = useMemo(() => {
    const active =
      tab === "qualified"
        ? all.filter(
            (c) => c.prospect.status === "qualified" || c.prospect.status === "ready_for_comms",
          )
        : all.filter((c) => c.prospect.status !== "passed" && c.prospect.status !== "archived");
    const filtered =
      filter === "all" ? active : active.filter((c) => c.evaluation.light === filter);
    return [...filtered].sort((a, b) => {
      const light = LIGHT_RANK[b.evaluation.light] - LIGHT_RANK[a.evaluation.light];
      if (light !== 0) return light;
      const score = b.evaluation.score - a.evaluation.score;
      if (score !== 0) return score;
      return b.lastCheckedAt.localeCompare(a.lastCheckedAt);
    });
  }, [all, tab, filter]);

  const counts = useMemo(() => {
    const pool =
      tab === "qualified"
        ? all.filter(
            (c) => c.prospect.status === "qualified" || c.prospect.status === "ready_for_comms",
          )
        : all.filter((c) => c.prospect.status !== "passed" && c.prospect.status !== "archived");
    return {
      all: pool.length,
      green: pool.filter((c) => c.evaluation.light === "green").length,
      yellow: pool.filter((c) => c.evaluation.light === "yellow").length,
      red: pool.filter((c) => c.evaluation.light === "red").length,
      neutral: pool.filter((c) => c.evaluation.light === "neutral").length,
    } as Record<FitFilter, number>;
  }, [all, tab]);

  const selected: ProspectCandidate | null =
    all.find((c) => c.prospect.id === selectedId) ?? null;

  function run(next: string) {
    const text = next.trim();
    if (!text) return;
    setQuery(text);
    if (looksLikeWebsite(text)) {
      research.mutate(text);
      return;
    }
    search.mutate(text);
  }

  const error = (search.error ??
    research.error ??
    setStatus.error ??
    override.error ??
    saved.error) as Error | null;
  const busy = search.isPending || research.isPending || setStatus.isPending;

  return (
    <div className="space-y-8">
      <AppHero
        appId="scout"
        eyebrow="Trust Tai OS / Scout"
        title="Who deserves our attention next?"
        supporting="One board of companies, scored conservatively against the active ICP. Colour reads fit only — the workflow stage stays separate."
        action={
          <TTButton asChild variant="secondary" size="sm">
            <Link to="/modules/scout/settings">
              <Settings2 aria-hidden />
              ICP settings
            </Link>
          </TTButton>
        }
      />

      <ScoutTabs active={tab} />

      {/* Input */}
      <section>
        <form
          className="tt-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            run(query);
          }}
        >
          <label htmlFor="scout-query" className="sr-only">
            Describe the kind of company we are looking for, or paste a website
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              id="scout-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Paste a company website — or describe who we are looking for"
              className="h-12 w-full rounded-lg border border-input bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <TTButton type="submit" disabled={busy || !query.trim()} className="shrink-0">
              {research.isPending
                ? "Researching…"
                : search.isPending
                  ? "Looking…"
                  : isWebsite
                    ? "Research website"
                    : "Find candidates"}
            </TTButton>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {isWebsite
                ? "Live public website research. Public pages only — no search engines or private data."
                : "Preview discovery. No external company search yet."}
            </p>
            {icp.data ? (
              <MetaPill>Using ICP v{icp.data.version}</MetaPill>
            ) : icp.isPending ? null : (
              <MetaPill>No ICP saved</MetaPill>
            )}
          </div>
          {tab === "scout" ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              {SCOUT_STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => run(prompt)}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
        </form>

        {research.isPending ? (
          <div
            role="status"
            aria-live="polite"
            className="tt-surface mt-3 flex items-center gap-3 p-4 text-sm text-muted-foreground"
          >
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-royal" />
            Reading the public pages on {query.trim()}. This takes a few moments.
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
      </section>

      {tab === "research" ? (
        <ResearchHistory candidates={all} onSelect={(c) => setSelectedId(c.prospect.id)} />
      ) : (
        <section>
          <SectionHeading
            eyebrow={tab === "qualified" ? "Carried forward" : "Clear output"}
            title={
              tab === "qualified"
                ? `${board.length} qualified compan${board.length === 1 ? "y" : "ies"}`
                : `${board.length} compan${board.length === 1 ? "y" : "ies"} on the board`
            }
            description={
              tab === "qualified"
                ? "Qualified in Scout. Nothing has been sent — each one is waiting on its next move."
                : "Sorted by strongest ICP fit, then by most recently checked. Colour is fit, not stage."
            }
            action={
              <FitFilters value={filter} counts={counts} onChange={setFilter} />
            }
          />

          {board.length === 0 ? (
            <EmptyState
              title={tab === "qualified" ? "Nothing qualified yet" : "The board is empty"}
              belongsHere={
                tab === "qualified"
                  ? "Companies you qualify in Scout appear here with their next move."
                  : "Companies Scout has read appear here with an ICP fit light and the evidence behind it."
              }
              whyItMatters="Fit is judged conservatively: three clear evidence points are required before anything reads green."
            />
          ) : (
            <ProspectBoard
              candidates={board}
              selectedId={selectedId}
              onSelect={(candidate) => setSelectedId(candidate.prospect.id)}
              emphasizeNextMove={tab === "qualified"}
            />
          )}
        </section>
      )}

      <ProspectDrawer
        candidate={selected}
        activeIcpVersion={icp.data?.version ?? null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onQualify={(id) => setStatus.mutate({ id, status: "qualified" })}
        onPass={(id) => setStatus.mutate({ id, status: "passed" })}
        onResearch={(websiteUrl) => research.mutate(websiteUrl)}
        onOverride={(id, light) => override.mutate({ id, light })}
        busy={busy || override.isPending}
      />
    </div>
  );
}

function ResearchHistory({
  candidates,
  onSelect,
}: {
  candidates: ProspectCandidate[];
  onSelect: (candidate: ProspectCandidate) => void;
}) {
  const history = [...candidates].sort((a, b) => b.lastCheckedAt.localeCompare(a.lastCheckedAt));

  return (
    <section>
      <SectionHeading
        eyebrow="Provenance"
        title="Research history"
        description="What Scout has read, when it read it, and which source it came from."
      />
      {history.length === 0 ? (
        <EmptyState
          title="No research yet"
          belongsHere="Every company Scout reads is recorded here with its source."
          whyItMatters="Knowing when something was last checked keeps decisions honest."
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {history.map((candidate) => (
            <li key={candidate.prospect.id}>
              <button
                type="button"
                onClick={() => onSelect(candidate)}
                className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5 text-left transition-colors last:border-b-0 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {candidate.prospect.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {candidate.source.kind === "live_website"
                      ? candidate.source.note ?? "Live website research"
                      : "Preview demo source"}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatChecked(candidate.lastCheckedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
