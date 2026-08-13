import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { useMemo, useState } from "react";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { FitFilters, ProspectBoard, type FitFilter } from "@/components/tt/prospect-board";
import { DiscoveryProgress, DiscoveryRuns } from "@/components/tt/discovery";
import { ScoutTabs } from "@/components/tt/scout-tabs";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { scoutService } from "@/data/supabase/scout-service";
import type { DiscoveryStage } from "@/data/supabase/scout-discovery";
import { SCOUT_STARTER_PROMPTS, type ProspectCandidate } from "@/domain/scout";
import type { FitLight } from "@/domain/scout-fit";
import { looksLikeWebsite } from "@/lib/website-url";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { formatChecked } from "@/components/tt/fit-light";

const TITLE = "Scout — Trust Tai OS";
const DESCRIPTION =
  "Source real companies from a plain-English target, rank them against the active ICP, and see the evidence behind every read.";

type Tab = "scout" | "qualified" | "research";

function parseSection(value: unknown): Tab {
  return value === "qualified" || value === "research" ? value : "scout";
}

function parseFit(value: unknown): FitFilter {
  return value === "green" || value === "yellow" || value === "red" || value === "neutral"
    ? value
    : "all";
}

export const Route = createFileRoute("/modules/scout/")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: parseSection(search["section"]),
    fit: parseFit(search["fit"]),
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
  component: ScoutRoute,
});

function ScoutRoute() {
  const { section, fit } = Route.useSearch();
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <Scout identity={identity} tab={section} filter={fit} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

const LIGHT_RANK: Record<FitLight, number> = { green: 3, yellow: 2, neutral: 1, red: 0 };

function Scout({
  identity,
  tab,
  filter,
}: {
  identity: WorkspaceIdentity;
  tab: Tab;
  /** Board filter lives in the URL so returning from a prospect restores it. */
  filter: FitFilter;
}) {
  const { organizationId, userId } = identity;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [stages, setStages] = useState<DiscoveryStage[]>([]);
  const setFilter = (next: FitFilter) =>
    navigate({ to: "/modules/scout", search: { section: tab, fit: next } });
  const isWebsite = looksLikeWebsite(query);

  const icp = useQuery({
    queryKey: ["scout", "icp", organizationId],
    queryFn: () => scoutService.icp(organizationId),
  });

  const status = useQuery({
    queryKey: ["scout", "discovery-status"],
    queryFn: () => scoutService.discoveryStatus(),
    staleTime: 5 * 60 * 1000,
  });

  const saved = useQuery({
    queryKey: ["scout", "prospects", organizationId],
    queryFn: () => scoutService.list(organizationId),
  });

  const runs = useQuery({
    queryKey: ["scout", "runs", organizationId],
    queryFn: () => scoutService.runs(organizationId),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] });
    await queryClient.invalidateQueries({ queryKey: ["scout", "runs", organizationId] });
  };

  const discover = useMutation({
    mutationFn: (text: string) => {
      setStages([]);
      return scoutService.discover({
        organizationId,
        query: text,
        onStage: (stage) => setStages((current) => [...current, stage]),
      });
    },
    onSuccess: refresh,
  });

  const research = useMutation({
    mutationFn: (websiteUrl: string) =>
      scoutService.research({ organizationId, userId, websiteUrl }),
    onSuccess: async (found) => {
      await refresh();
      await navigate({
        to: "/modules/scout/prospects/$prospectId",
        params: { prospectId: found.candidate.prospect.id },
        search: { section: tab, fit: filter },
      });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: "qualified" | "passed" }) =>
      scoutService.setStatus(id, next, { organizationId, userId }),
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

  const configured = status.data?.configured ?? true;

  function run(next: string) {
    const text = next.trim();
    if (!text) return;
    setQuery(text);
    if (looksLikeWebsite(text)) {
      research.mutate(text);
      return;
    }
    if (!configured) return;
    discover.mutate(text);
  }

  const error = (discover.error ??
    research.error ??
    setStatus.error ??
    override.error ??
    saved.error) as Error | null;
  const busy = discover.isPending || research.isPending || setStatus.isPending;
  const blocked = !configured && !isWebsite;

  return (
    <div className="space-y-8">
      <AppHero
        appId="scout"
        eyebrow="Trust Tai OS / Scout"
        title="Who deserves our attention next?"
        supporting="Describe the market and Scout sources real companies from the open web, ranks them against the active ICP, and shows the evidence behind every read."
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
            Describe the market to source, or paste one company website
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              id="scout-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. IT companies in Nashville — or paste one company website"
              className="h-12 w-full rounded-lg border border-input bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <TTButton
              type="submit"
              disabled={busy || blocked || !query.trim()}
              className="shrink-0"
            >
              {research.isPending
                ? "Researching…"
                : discover.isPending
                  ? "Sourcing…"
                  : isWebsite
                    ? "Research website"
                    : "Source companies"}
            </TTButton>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {isWebsite
                ? "Live public website research. Public pages only — no private data."
                : "Live market sourcing from the public web. Every company is saved with its sources."}
            </p>
            {icp.data ? (
              <MetaPill>Using ICP v{icp.data.version}</MetaPill>
            ) : icp.isPending ? null : (
              <MetaPill>No ICP saved</MetaPill>
            )}
            {status.data?.model ? <MetaPill>{status.data.model}</MetaPill> : null}
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

        {!configured ? (
          <div
            role="status"
            className="tt-surface mt-3 p-4 text-sm text-muted-foreground"
          >
            <p className="text-foreground">Market sourcing is not connected yet.</p>
            <p className="mt-1">
              Scout intelligence is connected through the Lovable AI Gateway. If market sourcing is
              unavailable, make sure <span className="font-mono text-[12px]">LOVABLE_API_KEY</span> is
              set in project secrets. Pasting a single company website still works, and nothing here
              is ever filled with demo data.
            </p>

          </div>
        ) : null}

        {discover.isPending || stages.length > 0 ? (
          <DiscoveryProgress stages={stages} running={discover.isPending} query={query.trim()} />
        ) : null}

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
        <>
          <DiscoveryRuns runs={runs.data ?? []} />
          <ResearchHistory candidates={all} linkSearch={{ section: tab, fit: filter }} />
        </>
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
            action={<FitFilters value={filter} counts={counts} onChange={setFilter} />}
          />

          {board.length === 0 ? (
            <EmptyState
              title={tab === "qualified" ? "Nothing qualified yet" : "The board is empty"}
              belongsHere={
                tab === "qualified"
                  ? "Companies you qualify in Scout appear here with their next move."
                  : "Describe a market above and Scout sources real companies, each with the sources it read."
              }
              whyItMatters="Fit is judged conservatively: thin evidence never reads green, and unknown is never treated as a mismatch."
            />
          ) : (
            <ProspectBoard
              candidates={board}
              linkSearch={{ section: tab, fit: filter }}
              emphasizeNextMove={tab === "qualified"}
            />
          )}
        </section>
      )}
    </div>
  );
}

function ResearchHistory({
  candidates,
  linkSearch,
}: {
  candidates: ProspectCandidate[];
  linkSearch: { section: Tab; fit: FitFilter };
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
              <Link
                to="/modules/scout/prospects/$prospectId"
                params={{ prospectId: candidate.prospect.id }}
                search={linkSearch}
                className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5 text-left transition-colors last:border-b-0 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {candidate.prospect.name}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {candidate.source.note ?? candidate.source.label}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatChecked(candidate.lastCheckedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
