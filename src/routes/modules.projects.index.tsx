/**
 * Projects — the delivery room for approved work.
 *
 * Not a generic project manager. The page answers six questions in order:
 * what has been approved, what is being built now, who owns it, what is
 * blocked, what is due next, and which company roadmap it came from.
 *
 * Everything on screen is derived from recorded truth. Health explains itself
 * in one sentence, lineage is never dropped, and progress is only drawn when a
 * person actually recorded delivery items.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState } from "@/components/tt/primitives";
import { NeedsAttention } from "@/components/tt/projects/index/attention";
import { CompanyGroups } from "@/components/tt/projects/index/company-group";
import {
  CreateProjectModal,
  type CreateProjectSeed,
} from "@/components/tt/projects/index/create-modal";
import { RoadmapHandoffs, type HandoffRow } from "@/components/tt/projects/index/handoff-list";
import {
  ProjectsEmptyState,
  ProjectsHeader,
  ProjectsSignals,
} from "@/components/tt/projects/index/header";
import { ProjectsGlanceRail, ProjectsSupportRail } from "@/components/tt/projects/index/rails";
import { ProjectsToolbar } from "@/components/tt/projects/index/toolbar";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import {
  EMPTY_PROJECT_FILTERS,
  buildProjectRows,
  companyOptions,
  filterProjectRows,
  groupByCompany,
  inTab,
  milestoneOptions,
  needsAttention,
  needsYou,
  ownerOptions,
  projectsGlance,
  recentlyCompleted,
  statusOptions,
  type LineageSources,
  type ProjectFilters,
  type ProjectRowModel,
  type ProjectsTab,
} from "@/data/projects/index-projection";
import { projectFromMilestone } from "@/data/projects-handoff";
import { readiness } from "@/data/roadmap-milestones";
import type { RoadmapIdentity } from "@/data/roadmap-index";
import { listApprovedMilestones } from "@/data/supabase/roadmap-handoffs";
import { projectsService, type ProjectsContext } from "@/data/supabase/projects-service";
import { roadmapService } from "@/data/supabase/roadmap-service";
import { scoutService } from "@/data/supabase/scout-service";
import type { ProjectInput } from "@/domain/projects";
import type { WorkspaceIdentity } from "@/lib/workspace";


const TITLE = "Projects — Approved work in motion — Trust Tai OS";
const DESCRIPTION =
  "Every approved roadmap milestone in delivery: the company it serves, who carries it, what is blocked, and what is due next.";

export const Route = createFileRoute("/modules/projects/")({
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
  component: ProjectsRoute,
});

function ProjectsRoute() {
  return <WorkspaceGate>{(identity) => <ProjectsRoom identity={identity} />}</WorkspaceGate>;
}

function ordinal(position: number): string {
  return String(position + 1).padStart(2, "0");
}

function ProjectsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"delivery" | "handoffs">("delivery");
  const [tab, setTab] = useState<ProjectsTab>("all");
  const [filters, setFilters] = useState<ProjectFilters>(EMPTY_PROJECT_FILTERS);
  const [search, setSearch] = useState("");
  const [seed, setSeed] = useState<CreateProjectSeed | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingMilestoneId, setPendingMilestoneId] = useState<string | null>(null);

  // Typing should not thrash the list; results settle a beat after the person stops.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilters((current) => ({ ...current, query: search })),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const context: ProjectsContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };


  const projectsQuery = useQuery({
    queryKey: ["projects", "list", identity.organizationId],
    queryFn: () => projectsService.list(identity.organizationId),
    retry: false,
  });

  // Lineage: roadmaps name the company, stages name the milestone.
  const roadmapsQuery = useQuery({
    queryKey: ["projects", "roadmaps", identity.organizationId],
    queryFn: () => roadmapService.list(identity.organizationId),
    retry: false,
  });

  const stagesQuery = useQuery({
    queryKey: ["projects", "stages", identity.organizationId],
    queryFn: () => roadmapService.stagesByRoadmap(identity.organizationId),
    retry: false,
  });

  // Scout carries the company identity (logo, theme) behind each roadmap.
  const scoutQuery = useQuery({
    queryKey: ["projects", "scout", identity.organizationId],
    queryFn: () => scoutService.list(identity.organizationId),
    retry: false,
  });

  const sources = useMemo<LineageSources>(() => {
    const roadmaps = roadmapsQuery.data ?? [];
    const stagesByRoadmap = stagesQuery.data ?? {};
    const roadmapCompany: Record<string, string> = {};
    for (const roadmap of roadmaps) {
      roadmapCompany[roadmap.id] = roadmap.subjectLabel || roadmap.title;
    }
    const milestones: LineageSources["milestones"] = {};
    for (const [roadmapId, stages] of Object.entries(stagesByRoadmap)) {
      [...stages]
        .sort((a, b) => a.position - b.position)
        .forEach((stage, index) => {
          milestones[stage.id] = { ordinal: ordinal(index), name: stage.title, roadmapId };
        });
    }
    return { milestones, roadmapCompany, clientCompany: {} };
  }, [roadmapsQuery.data, stagesQuery.data]);

  /** Company name → identity, resolved through the roadmap's Scout prospect. */
  const identities = useMemo(() => {
    const byProspect: Record<string, RoadmapIdentity> = {};
    for (const candidate of scoutQuery.data ?? []) {
      byProspect[candidate.prospect.id] = {
        websiteUrl: candidate.prospect.websiteUrl || candidate.prospect.domain,
        logoUrl: candidate.identity?.logoUrl ?? null,
        themeColor: candidate.identity?.themeColor ?? null,
      };
    }
    const byCompany: Record<string, RoadmapIdentity> = {};
    for (const roadmap of roadmapsQuery.data ?? []) {
      const found = roadmap.prospectId ? byProspect[roadmap.prospectId] : undefined;
      if (found) byCompany[roadmap.subjectLabel || roadmap.title] = found;
    }
    for (const candidate of scoutQuery.data ?? []) {
      const name = candidate.prospect.name;
      if (name && !byCompany[name]) {
        byCompany[name] = byProspect[candidate.prospect.id] ?? {};
      }
    }
    return byCompany;
  }, [scoutQuery.data, roadmapsQuery.data]);

  const rows = useMemo(
    () => buildProjectRows(projectsQuery.data ?? [], sources),
    [projectsQuery.data, sources],
  );

  // Ready from roadmap: approved milestones, and whether each already started.
  const approvedQuery = useQuery({
    queryKey: ["projects", "approved-milestones", identity.organizationId],
    queryFn: () => listApprovedMilestones(identity.organizationId),
    retry: false,
  });

  const handoffRows = useMemo<HandoffRow[]>(() => {
    const started = new Map<string, string>();
    for (const project of projectsQuery.data ?? []) {
      if (project.origin.milestoneId) started.set(project.origin.milestoneId, project.id);
    }
    return (approvedQuery.data ?? []).map((milestone) => {
      const company =
        sources.roadmapCompany[milestone.roadmapId] ?? "No company attached";
      const ready = readiness(milestone);
      const existing = started.get(milestone.id);
      return {
        milestone,
        company,
        ready: ready.ready,
        because: ready.because,
        ...(existing ? { existingProjectId: existing } : {}),
      };
    });
  }, [approvedQuery.data, projectsQuery.data, sources]);

  const create = useMutation({
    mutationFn: (input: ProjectInput) => projectsService.start(input, context),
    onSuccess: async (project) => {
      setModalOpen(false);
      setSeed(null);
      setPendingMilestoneId(null);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      void navigate({ to: "/modules/projects/$projectId", params: { projectId: project.id } });
    },
    onError: () => setPendingMilestoneId(null),
  });

  function openBlankCreate() {
    setSeed(null);
    create.reset();
    setModalOpen(true);
  }

  function openHandoffCreate(row: HandoffRow) {
    const handoff = projectFromMilestone(row.milestone, row.company);
    if (!handoff.ok) return;
    setPendingMilestoneId(row.milestone.id);
    create.reset();
    setSeed({
      name: handoff.input.name,
      company: row.company,
      pointA: handoff.input.pointA,
      pointB: handoff.input.pointB,
      ...(handoff.input.ownerLabel ? { ownerLabel: handoff.input.ownerLabel } : {}),
      ...(handoff.input.ownerUserId ? { ownerUserId: handoff.input.ownerUserId } : {}),
      ...(handoff.input.nextMove ? { nextMove: handoff.input.nextMove } : {}),
      origin: handoff.input.origin,
      lineageLine: `From ${row.company} · approved milestone “${row.milestone.name}”.`,
    });
    setModalOpen(true);
  }

  const glance = useMemo(() => projectsGlance(rows), [rows]);
  const attention = useMemo(() => needsAttention(rows), [rows]);
  const tabbed = useMemo(() => rows.filter((row) => inTab(row, tab)), [rows, tab]);
  const visible = useMemo(() => filterProjectRows(tabbed, filters), [tabbed, filters]);


  const counts = useMemo(
    () =>
      ({
        all: rows.length,
        in_progress: rows.filter((row) => inTab(row, "in_progress")).length,
        attention: rows.filter((row) => inTab(row, "attention")).length,
        waiting: rows.filter((row) => inTab(row, "waiting")).length,
        completed: rows.filter((row) => inTab(row, "completed")).length,
      }) satisfies Record<ProjectsTab, number>,
    [rows],
  );

  const thisWeek = useMemo(
    () =>
      rows
        .filter((row) => row.open && row.dueInDays !== null && row.dueInDays <= 7)
        .sort((a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0)),
    [rows],
  );

  const driver: ProjectRowModel | null = attention[0] ?? thisWeek[0] ?? null;

  function identityFor(company: string): RoadmapIdentity {
    return identities[company] ?? {};
  }

  const sidebar = <ProjectsGlanceRail glance={glance} driver={driver} />;

  if (projectsQuery.isError) {
    const error = projectsQuery.error;
    return (
      <AppShell identity={identity}>
        <EmptyState
          title="Projects could not be read."
          belongsHere="Delivery lives in the shared Trust Tai backend, read under your own access."
          whyItMatters={
            error instanceof Error ? error.message : "An unexpected error stopped the read."
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell identity={identity} sidebar={sidebar}>
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1 space-y-6">
          <ProjectsHeader
            onCreate={openBlankCreate}
            onHandoffs={() => setView(view === "handoffs" ? "delivery" : "handoffs")}
          />

          {view === "handoffs" ? (
            <section aria-labelledby="ready-from-roadmap" className="space-y-4">
              <div>
                <h2 id="ready-from-roadmap" className="font-display text-xl text-foreground">
                  Ready from roadmap
                </h2>
                <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">
                  Milestones a person approved in Roadmap. Creating a project carries the company,
                  outcome, owner and evidence across exactly as they were recorded.
                </p>
              </div>

              {approvedQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Reading approved milestones…</p>
              ) : approvedQuery.isError ? (
                <p role="alert" className="text-[13px] text-destructive">
                  {approvedQuery.error instanceof Error
                    ? approvedQuery.error.message
                    : "Approved milestones could not be read."}
                </p>
              ) : (
                <RoadmapHandoffs
                  rows={handoffRows}
                  pendingId={create.isPending ? pendingMilestoneId : null}
                  onCreate={openHandoffCreate}
                  onOpenProject={(projectId) =>
                    void navigate({ to: "/modules/projects/$projectId", params: { projectId } })
                  }
                />
              )}

              <button
                type="button"
                className="text-[12px] text-royal underline-offset-4 hover:underline"
                onClick={() => setView("delivery")}
              >
                Back to delivery
              </button>
            </section>
          ) : projectsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Reading delivery…</p>
          ) : rows.length === 0 ? (
            <ProjectsEmptyState />
          ) : (
            <>
              <ProjectsSignals glance={glance} />

              <NeedsAttention rows={attention} />

              <section aria-labelledby="all-projects" className="space-y-4">
                <h2 id="all-projects" className="sr-only">
                  Projects
                </h2>
                <ProjectsToolbar
                  tab={tab}
                  onTabChange={setTab}
                  counts={counts}
                  filters={{ ...filters, query: search }}
                  onFiltersChange={(next) => {
                    setSearch(next.query);
                    setFilters((current) => ({ ...next, query: current.query }));
                  }}
                  companies={companyOptions(rows)}
                  owners={ownerOptions(rows)}
                  statuses={statusOptions(rows)}
                  milestones={milestoneOptions(rows)}
                />

                {visible.length === 0 ? (
                  <p className="rounded-xl border border-border bg-card px-4 py-5 text-[13px] text-muted-foreground">
                    No projects match this view.{" "}
                    <button
                      type="button"
                      className="text-royal underline-offset-4 hover:underline"
                      onClick={() => {
                        setTab("all");
                        setSearch("");
                        setFilters(EMPTY_PROJECT_FILTERS);
                      }}
                    >
                      Clear filters
                    </button>
                  </p>
                ) : (
                  <CompanyGroups groups={groupByCompany(visible)} identityFor={identityFor} />
                )}
              </section>

              <p className="text-[12px] text-muted-foreground">
                Work enters Projects from an approved Roadmap milestone.{" "}
                <Link
                  to="/modules/roadmap"
                  className="text-royal underline-offset-4 hover:underline"
                >
                  Open Roadmap
                </Link>
              </p>
            </>
          )}
        </div>

        <aside className="hidden w-[300px] shrink-0 xl:block">
          <ProjectsSupportRail
            thisWeek={thisWeek}
            needsYou={needsYou(rows)}
            completed={recentlyCompleted(rows)}
          />
        </aside>
      </div>

      <CreateProjectModal
        open={modalOpen}
        seed={seed}
        pending={create.isPending}
        error={
          create.error instanceof Error
            ? create.error.message
            : create.error
              ? "That project could not be started."
              : null
        }
        onClose={() => {
          setModalOpen(false);
          setPendingMilestoneId(null);
        }}
        onCreate={(input) => create.mutate(input)}
      />
    </AppShell>

  );
}
