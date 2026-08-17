/**
 * Roadmap — one company, one roadmap, a clear path forward.
 *
 * The page answers four questions fast: which companies have a path, where
 * each path is going, which milestone is live, and what needs judgment next.
 * Everything is read from the live Trust Tai backend under the caller's own
 * access. A failure is reported as itself; there are no fixtures.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, TTButton, TTInput } from "@/components/tt/primitives";
import { BuildFromScoutPanel } from "@/components/tt/roadmap/index/build-from-scout";
import { DecisionAttentionCard } from "@/components/tt/roadmap/index/decision-card";
import { RoadmapHeader } from "@/components/tt/roadmap/index/header";
import { RoadmapList } from "@/components/tt/roadmap/index/list";
import { ReadyFromScout } from "@/components/tt/roadmap/index/ready-from-scout";
import { RoadmapSidebar } from "@/components/tt/roadmap/index/sidebar";
import { StartRoadmapForm, type StartRoadmapValues } from "@/components/tt/roadmap/start-form";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import {
  buildRoadmapRows,
  filterRoadmapRows,
  readyFromScout,
  roadmapGlance,
  ROADMAP_FILTERS,
  type RoadmapFilter,
  type RoadmapIdentity,
} from "@/data/roadmap-index";
import { listSubjects } from "@/data/supabase/roadmap-subjects";
import { roadmapService, type RoadmapContext } from "@/data/supabase/roadmap-service";
import { scoutService } from "@/data/supabase/scout-service";
import type { ProspectCandidate } from "@/domain/scout";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Roadmap — Point A to Point B — Trust Tai OS";
const DESCRIPTION =
  "Trust Tai's sequencing room: one roadmap per company, with the milestone path and the decisions that hold it up.";

export const Route = createFileRoute("/modules/roadmap/")({
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
  component: RoadmapRoute,
});

function RoadmapRoute() {
  return (
    <WorkspaceGate>{(identity) => <RoadmapRoom identity={identity} />}</WorkspaceGate>
  );
}

type Mode = "idle" | "scout" | "manual";

function RoadmapRoom({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const context: RoadmapContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const [mode, setMode] = useState<Mode>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RoadmapFilter>("all");

  const roadmapsQuery = useQuery({
    queryKey: ["roadmap", "list", identity.organizationId],
    queryFn: () => roadmapService.list(identity.organizationId),
    retry: false,
  });

  const stagesQuery = useQuery({
    queryKey: ["roadmap", "stages", identity.organizationId],
    queryFn: () => roadmapService.stagesByRoadmap(identity.organizationId),
    retry: false,
    enabled: !roadmapsQuery.isError,
  });

  const decisionsQuery = useQuery({
    queryKey: ["roadmap", "decisions", identity.organizationId],
    queryFn: () => roadmapService.openDecisions(identity.organizationId),
    retry: false,
    enabled: !roadmapsQuery.isError,
  });

  // Scout supplies both the company identity behind a roadmap and the
  // qualified companies that do not have one yet.
  const scoutQuery = useQuery({
    queryKey: ["roadmap", "scout", identity.organizationId],
    queryFn: () => scoutService.list(identity.organizationId),
    retry: false,
  });

  const subjectsQuery = useQuery({
    queryKey: ["roadmap", "subjects", identity.organizationId],
    queryFn: () => listSubjects(identity.organizationId),
    enabled: mode === "manual",
  });

  const create = useMutation({
    mutationFn: (values: StartRoadmapValues) =>
      roadmapService.create(
        {
          subject: { kind: values.subject.kind, id: values.subject.id },
          objective: values.objective,
          extraContext: values.extraContext || undefined,
        },
        context,
      ),
    onSuccess: async () => {
      setMode("idle");
      setStartError(null);
      await queryClient.invalidateQueries({ queryKey: ["roadmap"] });
    },
    onError: (error: unknown) =>
      setStartError(error instanceof Error ? error.message : "That roadmap could not be drafted."),
  });

  const roadmaps = useMemo(() => roadmapsQuery.data ?? [], [roadmapsQuery.data]);
  const candidates = useMemo(() => scoutQuery.data ?? [], [scoutQuery.data]);

  const identities = useMemo(() => {
    const map: Record<string, RoadmapIdentity> = {};
    for (const candidate of candidates) {
      map[candidate.prospect.id] = {
        websiteUrl: candidate.prospect.websiteUrl || candidate.prospect.domain,
        logoUrl: candidate.identity?.logoUrl ?? null,
        themeColor: candidate.identity?.themeColor ?? null,
      };
    }
    return map;
  }, [candidates]);

  const rows = useMemo(
    () =>
      buildRoadmapRows(roadmaps, stagesQuery.data ?? {}, decisionsQuery.data ?? [], identities),
    [roadmaps, stagesQuery.data, decisionsQuery.data, identities],
  );

  const glance = useMemo(() => roadmapGlance(rows), [rows]);
  const visible = useMemo(() => filterRoadmapRows(rows, query, filter), [rows, query, filter]);
  const attention = useMemo(() => rows.filter((row) => row.openDecisions.length > 0), [rows]);
  const ready = useMemo(() => readyFromScout(candidates, roadmaps), [candidates, roadmaps]);

  function startFromScout(candidate: ProspectCandidate, objective: string) {
    create.mutate({
      subject: {
        kind: "prospect",
        id: candidate.prospect.id,
        label: candidate.prospect.name,
        detail: `Scout · ${candidate.prospect.status}`,
      },
      objective,
      extraContext: "",
    });
  }

  const body = roadmapsQuery.isError ? (
    <EmptyState
      title="Roadmap could not be read."
      belongsHere="Roadmaps, their milestones, and their decisions live in the shared Trust Tai backend, read under your own access."
      whyItMatters={
        roadmapsQuery.error instanceof Error
          ? roadmapsQuery.error.message
          : "An unexpected error stopped the read."
      }
    />
  ) : (
    <div className="space-y-8">
      {attention.length > 0 ? (
        <section aria-labelledby="needs-decision" className="space-y-3">
          <h2 id="needs-decision" className="tt-eyebrow text-warning">
            Needs your decision
          </h2>
          <ul className="space-y-3">
            {attention.map((row) => (
              <li key={row.roadmapId}>
                <DecisionAttentionCard row={row} decision={row.openDecisions[0]!} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="company-roadmaps" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="company-roadmaps" className="text-[15px] font-medium text-foreground">
            Company roadmaps
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <TTInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roadmaps"
              aria-label="Search roadmaps"
              className="h-9 w-[200px] text-[13px]"
            />
            <div className="flex flex-wrap gap-1.5">
              {ROADMAP_FILTERS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setFilter(entry.id)}
                  aria-pressed={filter === entry.id}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] transition-colors",
                    filter === entry.id
                      ? "border-royal/30 bg-royal/8 text-royal"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No roadmaps yet."
            belongsHere="A roadmap belongs here once a company needs a sequenced path rather than a conversation."
            whyItMatters="Without one, the order of work lives in someone's head and depends on them being available."
            action={<TTButton onClick={() => setMode("scout")}>Build from Scout</TTButton>}
          />
        ) : visible.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No roadmap matches that search or filter.
          </p>
        ) : (
          <RoadmapList rows={visible} />
        )}
      </section>

      <ReadyFromScout
        candidates={ready}
        busy={create.isPending}
        onCreate={(candidate) => {
          setMode("scout");
          setStartError(null);
          void candidate;
        }}
      />
    </div>
  );

  return (
    <AppShell identity={identity} sidebar={<RoadmapSidebar glance={glance} />}>
      <div className="space-y-8">
        <RoadmapHeader
          glance={glance}
          onBuildFromScout={() => {
            setStartError(null);
            setMode("scout");
          }}
          onCreate={() => {
            setStartError(null);
            setMode("manual");
          }}
        />

        {mode === "scout" ? (
          <BuildFromScoutPanel
            candidates={ready}
            loading={scoutQuery.isLoading}
            busy={create.isPending}
            error={startError}
            onStart={startFromScout}
            onCancel={() => {
              setMode("idle");
              setStartError(null);
            }}
          />
        ) : null}

        {mode === "manual" ? (
          <StartRoadmapForm
            subjects={subjectsQuery.data ?? []}
            loading={subjectsQuery.isLoading}
            busy={create.isPending}
            error={startError}
            onStart={(values) => create.mutate(values)}
            onCancel={() => {
              setMode("idle");
              setStartError(null);
            }}
          />
        ) : null}

        {body}
      </div>
    </AppShell>
  );
}
