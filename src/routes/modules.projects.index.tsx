/**
 * Projects — the delivery room.
 *
 * Not a task board. Three questions lead: what is at risk, what is moving, and
 * what has landed. Every project reads its own health from the record and can
 * say why. Work enters here from an approved Roadmap milestone, or because a
 * person deliberately started it.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppHero } from "@/components/tt/app-hero";
import { AppShell } from "@/components/tt/app-shell";
import { EmptyState, MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { StateTrack, movedPhrase } from "@/components/tt/projects/state-track";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { projectsService } from "@/data/supabase/projects-service";
import {
  HEALTH_LABEL,
  isOpenProject,
  projectHealth,
  recommendedMove,
  type ExecutionProject,
} from "@/domain/projects";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Projects — Delivery truth — Trust Tai OS";
const DESCRIPTION =
  "Trust Tai's delivery room: decided work, who carries it, what is blocking it, and the one next move.";

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
  return (
    <WorkspaceGate>
      {(identity) => (
        <AppShell identity={identity}>
          <ProjectsRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function ProjectRow({ project }: { project: ExecutionProject }) {
  const health = projectHealth(project);
  const move = recommendedMove(project);
  const hasDetail =
    Boolean(project.pointA.trim() || project.pointB.trim() || project.executionBoundary?.trim()) ||
    project.dependencies.length > 0 ||
    project.evidence.length > 0;

  return (
    <li className="tt-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{HEALTH_LABEL[health.level]}</MetaPill>
        <MetaPill>Carried by {project.ownerLabel ?? "no one yet"}</MetaPill>
        {project.origin.kind === "roadmap_milestone" ? <MetaPill>From Roadmap</MetaPill> : null}
        {project.origin.subjectLabel ? <MetaPill>For {project.origin.subjectLabel}</MetaPill> : null}
      </div>
      <h3 className="mt-3 font-display text-2xl text-foreground">
        <Link
          to="/modules/projects/$projectId"
          params={{ projectId: project.id }}
          className="hover:underline underline-offset-4"
        >
          {project.name}
        </Link>
      </h3>

      <StateTrack state={project.state} className="mt-3" />

      <p className="mt-3 max-w-reading text-sm text-muted-foreground">{health.because}</p>

      {project.state === "blocked" ? (
        <p className="mt-3 max-w-reading border-l-2 border-destructive pl-3 text-sm text-foreground">
          Blocked: {project.blockedBecause?.trim() || "no reason recorded."}
        </p>
      ) : null}

      <p className="mt-3 max-w-reading text-sm text-foreground">Next move: {move.move}</p>
      <p className="mt-1 max-w-reading text-sm text-muted-foreground">{move.because}</p>

      {hasDetail ? (
        <details className="group mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground">
            <span className="group-open:hidden">What this rests on →</span>
            <span className="hidden group-open:inline">Hide detail</span>
          </summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Detail label="Point A" value={project.pointA} />
            <Detail label="Point B" value={project.pointB} />
            <Detail label="Execution boundary" value={project.executionBoundary ?? ""} />
            <Detail label="Dependencies" value={project.dependencies.join(", ")} />
          </dl>
          {project.evidence.length > 0 ? (
            <p className="mt-3 text-[13px] text-muted-foreground">
              {project.evidence.length} piece{project.evidence.length === 1 ? "" : "s"} of evidence
              carried from Roadmap.
            </p>
          ) : null}
        </details>
      ) : null}

      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {movedPhrase(project)}
      </p>
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="tt-eyebrow">{label}</dt>
      <dd className="mt-1 max-w-reading text-sm text-foreground">
        {value.trim() || "Not recorded yet."}
      </dd>
    </div>
  );
}

/** One calm read of the whole portfolio, before any individual project. */
function DeliveryStrip({ projects }: { projects: ExecutionProject[] }) {
  const open = projects.filter(isOpenProject);
  const counts = [
    { label: "At risk", value: open.filter((p) => projectHealth(p).level === "at_risk").length },
    {
      label: "Needs attention",
      value: open.filter((p) => projectHealth(p).level === "needs_attention").length,
    },
    { label: "In flight", value: open.filter((p) => projectHealth(p).level === "on_track").length },
    { label: "Landed", value: projects.length - open.length },
  ];

  return (
    <section aria-label="State of delivery" className="tt-surface p-6">
      <p className="tt-eyebrow">State of delivery</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {counts.map((entry) => (
          <div key={entry.label}>
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {entry.label}
            </dt>
            <dd className="mt-1 font-display text-3xl text-foreground">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}


function Group({ title, eyebrow, projects }: { title: string; eyebrow: string; projects: ExecutionProject[] }) {
  if (projects.length === 0) return null;
  return (
    <section className="space-y-4">
      <SectionHeading eyebrow={eyebrow} title={title} />
      <ul className="space-y-4">
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </ul>
    </section>
  );
}

function ProjectsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const projectsQuery = useQuery({
    queryKey: ["projects", "list", identity.organizationId],
    queryFn: () => projectsService.list(identity.organizationId),
    retry: false,
  });

  const hero = (
    <AppHero
      appId="projects"
      eyebrow="Trust Tai OS / Projects"
      title="Decided work, and what is actually happening to it."
      supporting="Projects does not invent work. It carries approved roadmap milestones into delivery and keeps one honest read on each of them."
    />
  );

  if (projectsQuery.isError) {
    const error = projectsQuery.error;
    return (
      <div className="space-y-8">
        {hero}
        <EmptyState
          title="Projects could not be read."
          belongsHere="Delivery lives in the shared Trust Tai backend, read under your own access."
          whyItMatters={error instanceof Error ? error.message : "An unexpected error stopped the read."}
        />
      </div>
    );
  }

  const projects = projectsQuery.data ?? [];
  const open = projects.filter(isOpenProject);
  const atRisk = open.filter((project) => projectHealth(project).level === "at_risk");
  const attention = open.filter((project) => projectHealth(project).level === "needs_attention");
  const moving = open.filter((project) => projectHealth(project).level === "on_track");
  const landed = projects.filter((project) => !isOpenProject(project));

  return (
    <div className="space-y-12">
      {hero}

      {projectsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading delivery…</p>
      ) : projects.length === 0 ? (
        <EmptyState
          title="Nothing is in delivery yet."
          belongsHere="Work enters Projects from an approved roadmap milestone, so delivery always has a decision behind it."
          whyItMatters="Starting work without an agreed Point B is how delivery quietly loses its destination."
          action={
            <TTButton asChild variant="secondary">
              <Link to="/modules/roadmap">Open Roadmap</Link>
            </TTButton>
          }
        />
      ) : (
        <>
          <DeliveryStrip projects={projects} />

          <Group eyebrow={`${atRisk.length} at risk`} title="Asking for you" projects={atRisk} />
          <Group
            eyebrow={`${attention.length} incomplete`}
            title="Missing something before they can move"
            projects={attention}
          />
          <Group eyebrow={`${moving.length} moving`} title="In flight" projects={moving} />
          <Group eyebrow={`${landed.length} finished`} title="Landed" projects={landed} />
        </>
      )}
    </div>
  );
}
