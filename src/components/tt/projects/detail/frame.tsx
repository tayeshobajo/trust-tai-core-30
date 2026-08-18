/**
 * The frame of a delivery room: utility row, identity header, outcome, tabs.
 *
 * The chain Company → Roadmap → Milestone → Project stays visible at the top
 * of the page, so execution never drifts away from the decision that caused it.
 */

import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ExternalLink, Target } from "lucide-react";

import { AmbientSurface } from "@/components/tt/ambient";
import { MetaPill, TTButton } from "@/components/tt/primitives";
import {
  SURFACE_STATUS_LABEL,
  SURFACE_STATUS_TONE,
  type ProjectRowModel,
} from "@/data/projects/index-projection";
import { cn } from "@/lib/utils";

export interface Neighbour {
  id: string;
  name: string;
}

export function UtilityRow({
  row,
  previous,
  next,
}: {
  row: ProjectRowModel;
  previous: Neighbour | null;
  next: Neighbour | null;
}) {
  const { lineage, project } = row;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
        <Link to="/modules/projects" className="text-muted-foreground hover:text-foreground">
          Projects
        </Link>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-border" />
        <span className="truncate text-muted-foreground">{lineage.company}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-border" />
        <span className="truncate font-medium text-foreground">{project.name}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        {lineage.roadmapId ? (
          <TTButton asChild size="sm" variant="secondary">
            <Link
              to="/modules/roadmap/$roadmapId"
              params={{ roadmapId: lineage.roadmapId }}
              search={{ view: "overview" as const }}
            >
              Open roadmap
              <ExternalLink aria-hidden />
            </Link>
          </TTButton>
        ) : null}
        <TTButton asChild size="sm" variant="secondary" disabled={!previous}>
          {previous ? (
            <Link to="/modules/projects/$projectId" params={{ projectId: previous.id }}>
              <ChevronLeft aria-hidden />
              Previous
            </Link>
          ) : (
            <span aria-disabled className="opacity-50">
              <ChevronLeft aria-hidden />
              Previous
            </span>
          )}
        </TTButton>
        <TTButton asChild size="sm" variant="secondary" disabled={!next}>
          {next ? (
            <Link to="/modules/projects/$projectId" params={{ projectId: next.id }}>
              Next
              <ChevronRight aria-hidden />
            </Link>
          ) : (
            <span aria-disabled className="opacity-50">
              Next
              <ChevronRight aria-hidden />
            </span>
          )}
        </TTButton>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="tt-eyebrow">{label}</p>
      <p className="mt-1 truncate text-[13px] text-foreground">{value}</p>
    </div>
  );
}

export function ProjectIdentityHeader({
  row,
  brand,
  updatedLabel,
  onUpdate,
}: {
  row: ProjectRowModel;
  brand: { accent?: string; logoUrl?: string } | null;
  updatedLabel: string;
  onUpdate: () => void;
}) {
  const { project, lineage } = row;
  const milestone = lineage.milestoneOrdinal
    ? `Roadmap Milestone ${lineage.milestoneOrdinal}`
    : lineage.fromRoadmap
      ? "From an approved roadmap milestone"
      : "Started in Projects";

  return (
    <AmbientSurface
      as="header"
      appId="projects"
      contextAccent={brand?.accent ?? null}
      rule
      className="tt-surface relative overflow-hidden p-6 md:p-8"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-5">
          <div className="hidden size-20 shrink-0 items-center justify-center rounded-xl border border-border bg-card md:flex">
            {brand?.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt={`${lineage.company} logo`}
                className="size-12 object-contain"
                loading="lazy"
              />
            ) : (
              <span className="font-display text-2xl text-muted-foreground">
                {lineage.company.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            <p className="text-[13px] font-medium text-muted-foreground">{lineage.company}</p>
            <h1 className="font-display text-[34px] leading-[1.1] text-foreground">
              {project.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                  SURFACE_STATUS_TONE[row.status],
                )}
              >
                {SURFACE_STATUS_LABEL[row.status]}
              </span>
              <span className="text-[13px] text-muted-foreground">{milestone}</span>
            </div>

            <dl className="grid max-w-2xl grid-cols-2 gap-4 pt-2 sm:grid-cols-4">
              <Meta label="Owner" value={row.ownerLabel} />
              <Meta label="Due" value={row.due} />
              <Meta label="Health" value={row.healthLabel} />
              <Meta label="Updated" value={updatedLabel} />
            </dl>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <TTButton variant="signal" onClick={onUpdate}>
            Update project
          </TTButton>
          {lineage.roadmapId ? (
            <TTButton asChild variant="secondary">
              <Link
                to="/modules/roadmap/$roadmapId"
                params={{ roadmapId: lineage.roadmapId }}
                search={{ view: "milestones" as const }}
              >
                Open roadmap milestone
              </Link>
            </TTButton>
          ) : null}
        </div>
      </div>
    </AmbientSurface>
  );
}

export function OutcomeStrip({ outcome }: { outcome: string }) {
  return (
    <section aria-label="Outcome" className="tt-surface flex gap-4 p-6">
      <Target aria-hidden className="mt-0.5 size-5 shrink-0 text-royal" />
      <div className="min-w-0">
        <p className="tt-eyebrow">Outcome</p>
        <p className="mt-1 max-w-reading text-[17px] leading-relaxed text-foreground">{outcome}</p>
      </div>
    </section>
  );
}

export const PROJECT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "context", label: "Context" },
  { value: "knowledge", label: "Knowledge" },
  { value: "assets", label: "Assets" },
  { value: "work", label: "Work" },
  { value: "blockers", label: "Blockers" },
  { value: "decisions", label: "Decisions" },
  { value: "files", label: "Files" },
  { value: "activity", label: "Activity" },
] as const;


export type ProjectTab = (typeof PROJECT_TABS)[number]["value"];

export function ProjectTabs({
  tab,
  counts,
  onChange,
}: {
  tab: ProjectTab;
  counts: Partial<Record<ProjectTab, number>>;
  onChange: (tab: ProjectTab) => void;
}) {
  return (
    <div role="tablist" aria-label="Project sections" className="flex flex-wrap gap-1 border-b border-border">
      {PROJECT_TABS.map((entry) => {
        const active = entry.value === tab;
        const count = counts[entry.value];
        return (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(entry.value)}
            className={cn(
              "-mb-px border-b-2 px-4 py-3 text-[13px] transition-colors",
              active
                ? "border-royal font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
            {count ? <MetaPill className="ml-2">{count}</MetaPill> : null}
          </button>
        );
      })}
    </div>
  );
}
