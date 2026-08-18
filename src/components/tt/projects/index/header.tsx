/**
 * Projects header + operating signals, in one boxed band that matches the
 * Roadmap hero: the page statement, one line of orientation, two actions, and
 * four numbers worth reading.
 */

import { Link } from "@tanstack/react-router";
import { AlertCircle, CalendarDays, FolderKanban, Lock, Plus } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { RoomHero } from "@/components/tt/room-hero";
import type { ProjectsGlance } from "@/data/projects/index-projection";

export function ProjectsHeader({
  glance,
  onCreate,
  onHandoffs,
}: {
  glance: ProjectsGlance;
  onCreate: () => void;
  onHandoffs: () => void;
}) {
  return (
    <RoomHero
      eyebrow="Projects"
      title="Approved work, in motion."
      supporting="Each project keeps its company, roadmap milestone, owner and outcome attached."
      actions={
        <>
          <TTButton onClick={onCreate}>
            <Plus aria-hidden />
            Create project
          </TTButton>
          <TTButton variant="secondary" onClick={onHandoffs}>
            View roadmap handoffs
          </TTButton>
        </>
      }
      metrics={[
        {
          icon: <FolderKanban className="size-4 text-royal" aria-hidden />,
          tone: "bg-royal/10",
          value: glance.active,
          label: "Active projects",
          note: `Across ${glance.companies} ${glance.companies === 1 ? "company" : "companies"}`,
        },
        {
          icon: <AlertCircle className="size-4 text-warning" aria-hidden />,
          tone: "bg-warning/12",
          value: glance.attention,
          label: "Need attention",
          note: "Require your review",
        },
        {
          icon: <CalendarDays className="size-4 text-success" aria-hidden />,
          tone: "bg-success/12",
          value: glance.dueThisWeek,
          label: "Due this week",
          note: "Across all projects",
        },
        {
          icon: <Lock className="size-4 text-destructive" aria-hidden />,
          tone: "bg-destructive/10",
          value: glance.blocked,
          label: "Blocked",
          note: "Waiting to move forward",
        },
      ]}
    />
  );
}


export function ProjectsEmptyState() {
  return (
    <section className="rounded-xl border border-border bg-card p-8">
      <h2 className="font-display text-2xl text-foreground">
        No approved work has entered delivery yet.
      </h2>
      <p className="mt-2 max-w-reading text-sm text-muted-foreground">
        Projects begins when a Roadmap milestone is approved for execution.
      </p>
      <ol className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <li className="rounded-full border border-border px-3 py-1.5">Roadmap milestone</li>
        <li aria-hidden>→</li>
        <li className="rounded-full border border-border px-3 py-1.5">Project</li>
        <li aria-hidden>→</li>
        <li className="rounded-full border border-border px-3 py-1.5">Delivery</li>
      </ol>
      <div className="mt-6 flex flex-wrap gap-2">
        <TTButton asChild size="sm">
          <Link to="/modules/roadmap">Open Roadmap</Link>
        </TTButton>
        <TTButton asChild size="sm" variant="secondary">
          <Link to="/modules/roadmap">View approved milestones</Link>
        </TTButton>
      </div>
    </section>
  );
}
