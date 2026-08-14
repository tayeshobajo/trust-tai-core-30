/**
 * A single piece of delivery.
 *
 * Point A, Point B, who carries it, what it rests on, and the one move it is
 * asking for. State changes are a person's decision and are mirrored into the
 * shared activity stream, so the rest of the suite reads the same truth.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import {
  EmptyState,
  MetaPill,
  PageHeader,
  SectionHeading,
  TTButton,
  TTInput,
} from "@/components/tt/primitives";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { projectsService, type ProjectsContext } from "@/data/supabase/projects-service";
import {
  EXECUTION_STATES,
  EXECUTION_STATE_LABEL,
  HEALTH_LABEL,
  projectHealth,
  recommendedMove,
  type ExecutionProject,
  type ExecutionState,
} from "@/domain/projects";
import type { WorkspaceIdentity } from "@/lib/workspace";

export const Route = createFileRoute("/modules/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project — Delivery — Trust Tai OS" },
      {
        name: "description",
        content: "One piece of Trust Tai delivery: Point A, Point B, owner, blocks and next move.",
      },
      { property: "og:title", content: "Project — Delivery — Trust Tai OS" },
      {
        property: "og:description",
        content: "One piece of Trust Tai delivery: Point A, Point B, owner, blocks and next move.",
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
          <ProjectWorkspace identity={identity} projectId={projectId} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="tt-eyebrow">{label}</p>
      <p className="mt-1 max-w-reading text-sm text-foreground">{value || "Not recorded yet."}</p>
    </div>
  );
}

function ProjectWorkspace({
  identity,
  projectId,
}: {
  identity: WorkspaceIdentity;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const context: ProjectsContext = {
    organizationId: identity.organizationId,
    userId: identity.userId,
    userLabel: identity.name,
  };

  const projectQuery = useQuery({
    queryKey: ["projects", "detail", projectId, identity.organizationId],
    queryFn: () => projectsService.get(projectId, identity.organizationId),
    retry: false,
  });

  const [nextMove, setNextMove] = useState("");
  const [blocked, setBlocked] = useState("");

  const update = useMutation({
    mutationFn: (changes: Parameters<typeof projectsService.update>[1]) => {
      const project = projectQuery.data;
      if (!project) throw new Error("This project is no longer readable.");
      return projectsService.update(project, changes, context);
    },
    onSuccess: async () => {
      setNextMove("");
      setBlocked("");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Reading this work…</p>;
  }

  if (projectQuery.isError || !projectQuery.data) {
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

  const project: ExecutionProject = projectQuery.data;
  const health = projectHealth(project);
  const move = recommendedMove(project);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Trust Tai OS / Projects"
        title={project.name}
        supporting={health.because}
      />

      <div className="flex flex-wrap gap-2">
        <MetaPill>{EXECUTION_STATE_LABEL[project.state]}</MetaPill>
        <MetaPill>{HEALTH_LABEL[health.level]}</MetaPill>
        <MetaPill>Carried by {project.ownerLabel ?? "no one yet"}</MetaPill>
        {project.origin.subjectLabel ? <MetaPill>For {project.origin.subjectLabel}</MetaPill> : null}
      </div>

      <section className="tt-surface space-y-5 p-6">
        <SectionHeading eyebrow="The move" title={move.move} description={move.because} />
        <div className="flex flex-wrap gap-2">
          {EXECUTION_STATES.filter((state) => state !== project.state).map((state) => (
            <TTButton
              key={state}
              size="sm"
              variant={state === "blocked" ? "quiet" : "secondary"}
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  state: state as ExecutionState,
                  ...(state === "blocked" && blocked.trim() ? { blockedBecause: blocked.trim() } : {}),
                })
              }
            >
              {EXECUTION_STATE_LABEL[state]}
            </TTButton>
          ))}
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
              disabled={update.isPending || nextMove.trim().length === 0}
              onClick={() => update.mutate({ nextMove: nextMove.trim() })}
            >
              Record next move
            </TTButton>
          </div>
          <div className="space-y-2">
            <TTInput
              value={blocked}
              onChange={(event) => setBlocked(event.target.value)}
              placeholder="What is blocking this"
              aria-label="Blocking reason"
            />
            <TTButton
              size="sm"
              variant="secondary"
              disabled={update.isPending || blocked.trim().length === 0}
              onClick={() => update.mutate({ state: "blocked", blockedBecause: blocked.trim() })}
            >
              Record a block
            </TTButton>
          </div>
        </div>
        {update.error ? (
          <p role="alert" className="text-sm text-destructive">
            {update.error instanceof Error ? update.error.message : "That change could not be saved."}
          </p>
        ) : null}
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <Line label="Point A" value={project.pointA} />
        <Line label="Point B" value={project.pointB} />
        <Line label="Execution boundary" value={project.executionBoundary ?? ""} />
        <Line label="Dependencies" value={project.dependencies.join(", ")} />
      </section>

      {project.evidence.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading
            eyebrow="What this rests on"
            title="Evidence carried from Roadmap"
            description="Delivery inherits the evidence the decision was made on. Nothing new is claimed here."
          />
          <ul className="space-y-1">
            {project.evidence.map((ref) => (
              <li key={`${ref.label}-${ref.url ?? ""}`} className="text-sm text-muted-foreground">
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {ref.label}
                  </a>
                ) : (
                  ref.label
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {project.origin.roadmapId ? (
        <TTButton asChild variant="secondary">
          <Link
            to="/modules/roadmap/$roadmapId"
            params={{ roadmapId: project.origin.roadmapId }}
            search={{ view: "build" as const }}
          >
            Open the roadmap this came from
          </Link>
        </TTButton>
      ) : null}
    </div>
  );
}
