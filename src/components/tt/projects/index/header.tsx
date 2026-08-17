/**
 * Projects header + operating signals. Compact by design: the page statement,
 * two lines of orientation, two actions, and four numbers worth reading.
 */

import { Link } from "@tanstack/react-router";
import { AlertCircle, CalendarDays, FolderKanban, Lock, Plus } from "lucide-react";
import type { ComponentType } from "react";

import { TTButton } from "@/components/tt/primitives";
import type { ProjectsGlance } from "@/data/projects/index-projection";

export function ProjectsHeader({
  onCreate,
  onHandoffs,
}: {
  onCreate: () => void;
  onHandoffs: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
      <div className="min-w-0">
        <p className="tt-eyebrow">Projects</p>
        <h1 className="mt-1 font-display text-[26px] leading-tight tracking-tight text-foreground">
          Approved work, in motion.
        </h1>
        <p className="mt-0.5 max-w-reading text-[13px] text-muted-foreground">
          Each project keeps its company, roadmap milestone, owner and outcome attached.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <TTButton size="sm" onClick={onCreate}>
          <Plus aria-hidden className="size-4" />
          Create project
        </TTButton>
        <TTButton size="sm" variant="secondary" onClick={onHandoffs}>
          View roadmap handoffs
        </TTButton>
      </div>
    </header>
  );
}

function Signal({
  icon: Icon,
  value,
  label,
  note,
  tone,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: number;
  label: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-2xl leading-none text-foreground">{value}</span>
        <span className="mt-1 block truncate text-[13px] text-foreground">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

export function ProjectsSignals({ glance }: { glance: ProjectsGlance }) {
  return (
    <section aria-label="State of delivery" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Signal
        icon={FolderKanban}
        value={glance.active}
        label="Active projects"
        note={`Across ${glance.companies} ${glance.companies === 1 ? "company" : "companies"}`}
        tone="bg-royal/10 text-royal"
      />
      <Signal
        icon={AlertCircle}
        value={glance.attention}
        label="Need attention"
        note="Require your review"
        tone="bg-warning/12 text-warning"
      />
      <Signal
        icon={CalendarDays}
        value={glance.dueThisWeek}
        label="Due this week"
        note="Across all projects"
        tone="bg-success/12 text-success"
      />
      <Signal
        icon={Lock}
        value={glance.blocked}
        label="Blocked"
        note="Waiting to move forward"
        tone="bg-destructive/10 text-destructive"
      />
    </section>
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
