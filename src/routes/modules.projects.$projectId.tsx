/**
 * The delivery room for one approved roadmap milestone.
 *
 * It answers four things without scrolling: what we are building, why we are
 * building it, what is happening now, and what is stopping it from moving.
 * The chain Company → Roadmap → Milestone → Project → Delivery → Outcome stays
 * visible, because execution without lineage is just activity.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, TTButton, TTInput } from "@/components/tt/primitives";
import { LaunchOpsButton } from "@/components/tt/ops/launch-ops";
import { RouteWork } from "@/components/tt/projects/route-work";
import {
  OutcomeStrip,
  PROJECT_TABS,
  ProjectIdentityHeader,
  ProjectTabs,
  UtilityRow,
  type ProjectTab,
} from "@/components/tt/projects/detail/frame";
import { OverviewTab } from "@/components/tt/projects/detail/overview";
import { DetailRail } from "@/components/tt/projects/detail/rail";
import {
  ActivityTab,
  BlockersTab,
  DecisionsTab,
  FilesTab,
  WorkTab,
} from "@/components/tt/projects/detail/sections";
import {
  completionModel,
  healthSignals,
  needsJudgment,
  peopleOnProject,
} from "@/data/projects/detail-projection";
import { buildProjectRow, lineageSourcesFrom } from "@/data/projects/index-projection";
import { projectDelivery, type DeliveryContext } from "@/data/supabase/project-delivery";
import { readRoadmapBrand } from "@/data/supabase/roadmap-brand";
import { roadmapService } from "@/data/supabase/roadmap-service";
import { supabaseActivity } from "@/data/supabase/activities";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { projectsService, type ProjectsContext } from "@/data/supabase/projects-service";
import {
  EXECUTION_STATE_LABEL,
  checkTransition,
  isOpenProject,
  nextStates,
  type ExecutionState,
} from "@/domain/projects";
import type { ProjectFileKind, WorkItemStatus } from "@/domain/project-delivery";
import { workspaceAccess, type WorkspaceIdentity } from "@/lib/workspace";

export const Route = createFileRoute("/modules/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Delivery room · Projects · Trust Tai OS" },
      {
        name: "description",
        content:
          "One approved milestone in delivery: outcome, current work, blockers, decisions and lineage back to the roadmap.",
      },
      { property: "og:title", content: "Delivery room · Projects · Trust Tai OS" },
      {
        property: "og:description",
        content:
          "One approved milestone in delivery: outcome, current work, blockers, decisions and lineage back to the roadmap.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <DeliveryRoom identity={identity} projectId={projectId} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function DeliveryRoom({
  identity,
  projectId,
}: {
  identity: WorkspaceIdentity;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [updating, setUpdating] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");
  const [nextMove, setNextMove] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const org = identity.organizationId;
  const projectsContext: ProjectsContext = {
    organizationId: org,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const projectQuery = useQuery({
    queryKey: ["projects", "detail", projectId, org],
    queryFn: () => projectsService.get(projectId, org),
    retry: false,
  });
  const allProjectsQuery = useQuery({
    queryKey: ["projects", "list", org],
    queryFn: () => projectsService.list(org),
    retry: false,
  });
  const roadmapsQuery = useQuery({
    queryKey: ["projects", "roadmaps", org],
    queryFn: () => roadmapService.list(org),
    retry: false,
  });
  const stagesQuery = useQuery({
    queryKey: ["projects", "stages", org],
    queryFn: () => roadmapService.stagesByRoadmap(org),
    retry: false,
  });

  const project = projectQuery.data ?? null;

  const delivery: DeliveryContext = {
    organizationId: org,
    projectId,
    projectName: project?.name ?? "Project",
    userId: identity.userId,
    userLabel: identity.name,
  };

  const enabled = Boolean(project);
  const workQuery = useQuery({
    queryKey: ["delivery", "work", projectId, org],
    queryFn: () => projectDelivery.listWork(delivery),
    enabled,
    retry: false,
  });
  const blockersQuery = useQuery({
    queryKey: ["delivery", "blockers", projectId, org],
    queryFn: () => projectDelivery.listBlockers(delivery),
    enabled,
    retry: false,
  });
  const decisionsQuery = useQuery({
    queryKey: ["delivery", "decisions", projectId, org],
    queryFn: () => projectDelivery.listDecisions(delivery),
    enabled,
    retry: false,
  });
  const filesQuery = useQuery({
    queryKey: ["delivery", "files", projectId, org],
    queryFn: () => projectDelivery.listFiles(delivery),
    enabled,
    retry: false,
  });
  const activityQuery = useQuery({
    queryKey: ["delivery", "activity", projectId, org],
    queryFn: () =>
      supabaseActivity.list({
        organizationId: org,
        subjectType: "project",
        subjectId: projectId,
        limit: 40,
      }),
    enabled,
    retry: false,
  });

  const roadmaps = roadmapsQuery.data ?? [];
  const row = useMemo(
    () =>
      project
        ? buildProjectRow(project, lineageSourcesFrom(roadmaps, stagesQuery.data ?? {}))
        : null,
    [project, roadmaps, stagesQuery.data],
  );

  const roadmap = row?.lineage.roadmapId
    ? (roadmaps.find((entry) => entry.id === row.lineage.roadmapId) ?? null)
    : null;
  const brandQuery = useQuery({
    queryKey: ["delivery", "brand", roadmap?.id ?? "none"],
    queryFn: () => (roadmap ? readRoadmapBrand(roadmap) : Promise.resolve(null)),
    enabled: Boolean(roadmap),
    retry: false,
  });

  const items = workQuery.data ?? [];
  const blockers = blockersQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];
  const files = filesQuery.data ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["delivery"] });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const mutate = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
  });

  const updateProject = useMutation({
    mutationFn: (changes: Parameters<typeof projectsService.update>[1]) => {
      if (!project) throw new Error("This project is no longer readable.");
      return projectsService.update(project, changes, projectsContext);
    },
    onSuccess: async () => {
      setBlockedReason("");
      setNextMove("");
      await refresh();
    },
  });

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Reading this work…</p>;
  }

  if (projectQuery.isError || !project || !row) {
    return (
      <EmptyState
        title="That project could not be read."
        belongsHere="Delivery lives in the shared Trust Tai backend, read under your own access."
        whyItMatters={
          projectQuery.error instanceof Error
            ? projectQuery.error.message
            : "It may have been closed, or it belongs to another organization."
        }
        action={
          <TTButton asChild variant="secondary">
            <Link to="/modules/projects">Back to Projects</Link>
          </TTButton>
        }
      />
    );
  }

  const siblings = (allProjectsQuery.data ?? []).filter(
    (entry) => entry.origin.subjectLabel === project.origin.subjectLabel,
  );
  const position = siblings.findIndex((entry) => entry.id === project.id);
  const previous =
    position > 0 && siblings[position - 1]
      ? { id: siblings[position - 1]!.id, name: siblings[position - 1]!.name }
      : null;
  const next =
    position >= 0 && siblings[position + 1]
      ? { id: siblings[position + 1]!.id, name: siblings[position + 1]!.name }
      : null;

  const completion = completionModel(project, items, row.lineage.milestoneName);
  const attention = needsJudgment(project, items, blockers, decisions);
  const busy = mutate.isPending || updateProject.isPending;
  const error = mutate.error ?? updateProject.error;
  const errorMessage = fileError
    ? fileError
    : error
      ? error instanceof Error
        ? error.message
        : "That change could not be saved."
      : null;

  const openTab = (value: "work" | "blockers" | "decisions") => setTab(value);

  return (
    <div className="space-y-6">
      <UtilityRow row={row} previous={previous} next={next} />

      <ProjectIdentityHeader
        row={row}
        brand={brandQuery.data ?? null}
        updatedLabel={new Date(project.updatedAt).toLocaleDateString()}
        onUpdate={() => setUpdating((open) => !open)}
      />

      {updating ? (
        <section aria-label="Update project" className="tt-surface space-y-4 p-6">
          <p className="tt-eyebrow">Move this project</p>
          <div className="flex flex-wrap gap-2">
            {nextStates(project).map((state) => {
              const check = checkTransition(
                project,
                state,
                blockedReason.trim() ? { blockedBecause: blockedReason.trim() } : {},
              );
              return (
                <TTButton
                  key={state}
                  size="sm"
                  variant={state === "blocked" ? "quiet" : "secondary"}
                  disabled={busy || !check.ok}
                  title={check.because}
                  onClick={() =>
                    updateProject.mutate({
                      state: state as ExecutionState,
                      ...(state === "blocked" && blockedReason.trim()
                        ? { blockedBecause: blockedReason.trim() }
                        : {}),
                    })
                  }
                >
                  {EXECUTION_STATE_LABEL[state]}
                </TTButton>
              );
            })}
            {nextStates(project).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Closed work does not move again. Start it fresh if it is genuinely back.
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <TTInput
                value={nextMove}
                onChange={(event) => setNextMove(event.target.value)}
                placeholder="Write the next move in one sentence"
                aria-label="Next move"
              />
              <TTButton
                size="sm"
                disabled={busy || nextMove.trim().length === 0}
                onClick={() => updateProject.mutate({ nextMove: nextMove.trim() })}
              >
                Record next move
              </TTButton>
            </div>
            <div className="space-y-2">
              <TTInput
                value={blockedReason}
                onChange={(event) => setBlockedReason(event.target.value)}
                placeholder="What is blocking this"
                aria-label="Blocking reason"
              />
              <TTButton
                size="sm"
                variant="secondary"
                disabled={busy || blockedReason.trim().length === 0}
                onClick={() =>
                  updateProject.mutate({
                    state: "blocked",
                    blockedBecause: blockedReason.trim(),
                  })
                }
              >
                Record a block
              </TTButton>
            </div>
          </div>
        </section>
      ) : null}

      <OutcomeStrip outcome={completion.outcome} />

      <ProjectTabs
        tab={tab}
        counts={{
          work: items.length,
          blockers: blockers.filter((entry) => entry.status === "open").length,
          decisions: decisions.filter((entry) => entry.status === "open").length,
          files: files.length,
        }}
        onChange={setTab}
      />

      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {tab === "overview" ? (
            <OverviewTab
              project={project}
              lineage={row.lineage}
              items={items}
              blockers={blockers}
              completion={completion}
              onOpenTab={openTab}
            />
          ) : null}

          {tab === "work" ? (
            <div className="space-y-5">
              <WorkTab
                items={items}
                busy={busy}
                onAdd={(title) =>
                  mutate.mutate(() =>
                    projectDelivery.addWork({ title, sequence: items.length }, delivery),
                  )
                }
                onMove={(item, status: WorkItemStatus) =>
                  mutate.mutate(() => projectDelivery.moveWork(item, status, delivery))
                }
              />
              {isOpenProject(project) ? (
                <>
                  <section aria-label="Technical stewardship" className="tt-surface space-y-3 p-6">
                    <p className="tt-eyebrow">Ops</p>
                    <p className="max-w-reading text-[15px] text-foreground">
                      Ops runs the technical work for this project. Your session is handed over
                      securely and this project&apos;s id travels with it.
                    </p>
                    <LaunchOpsButton
                      variant="secondary"
                      label="Open in Ops"
                      organizationId={org}
                      returnContext="project"
                      canonicalProjectId={project.id}
                    />
                  </section>
                  <RouteWork
                    project={project}
                    context={projectsContext}
                    access={workspaceAccess(identity)}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "blockers" ? (
            <BlockersTab
              items={items}
              blockers={blockers}
              busy={busy}
              onRaise={(input) => mutate.mutate(() => projectDelivery.raiseBlocker(input, delivery))}
              onResolve={(blocker, resolution, resumeWork) =>
                mutate.mutate(async () => {
                  const saved = await projectDelivery.resolveBlocker(
                    blocker,
                    resolution,
                    delivery,
                  );
                  // Clearing a blocker may put its work item back in motion. Roadmap
                  // truth is untouched: only the delivery record moves.
                  const linked = blocker.workItemId
                    ? items.find((entry) => entry.id === blocker.workItemId)
                    : undefined;
                  if (resumeWork && linked && linked.status === "blocked") {
                    await projectDelivery.moveWork(linked, "in_progress", delivery);
                  }
                  return saved;
                })
              }
            />
          ) : null}

          {tab === "decisions" ? (
            <DecisionsTab
              items={items}
              decisions={decisions}
              busy={busy}
              onAsk={(input) => mutate.mutate(() => projectDelivery.askDecision(input, delivery))}
              onAnswer={(decision, answer) =>
                mutate.mutate(() => projectDelivery.answerDecision(decision, answer, delivery))
              }
            />
          ) : null}

          {tab === "files" ? (
            <FilesTab
              items={items}
              files={files}
              busy={busy}
              onUpload={(file, kind: ProjectFileKind, workItemId) =>
                mutate.mutate(() =>
                  projectDelivery.uploadFile(
                    file,
                    { kind, ...(workItemId ? { workItemId } : {}) },
                    delivery,
                  ),
                )
              }
              onOpen={(file, download) => {
                setFileError(null);
                void projectDelivery
                  .fileUrl(file, download)
                  .then((url) => {
                    if (download) {
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = file.name;
                      anchor.rel = "noopener";
                      document.body.appendChild(anchor);
                      anchor.click();
                      anchor.remove();
                      return;
                    }
                    window.open(url, "_blank", "noopener,noreferrer");
                  })
                  .catch((cause: unknown) => {
                    setFileError(
                      cause instanceof Error ? cause.message : "That file could not be opened.",
                    );
                  });
              }}
            />
          ) : null}

          {tab === "activity" ? <ActivityTab events={activityQuery.data ?? []} /> : null}
        </div>

        <DetailRail
          ownerLabel={row.ownerLabel}
          attention={attention}
          signals={healthSignals(project, items, blockers)}
          people={peopleOnProject(project, items)}
          lineage={row.lineage}
          busy={busy}
          onOpenTab={openTab}
          onAddWork={() => setTab("work")}
          onRaiseBlocker={() => setTab("blockers")}
          onAskDecision={() => setTab("decisions")}
          onComplete={() => updateProject.mutate({ state: "delivered" })}
        />
      </div>

      <p className="text-[13px] text-muted-foreground">
        {PROJECT_TABS.length} sections, one record. Everything here is written to the shared
        activity stream so Pulse and Ask Trust Tai read the same truth.
      </p>
    </div>
  );
}
