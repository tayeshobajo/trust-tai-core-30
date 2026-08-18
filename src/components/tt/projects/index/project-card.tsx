/**
 * A project card. Lineage first, then outcome, then what is actually happening.
 * The card never invents progress: when no delivery items are recorded it says
 * which stage the work is at instead of showing a hollow bar.
 */

import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import { CompanyMark } from "@/components/tt/company-identity";
import { ProjectActionBar, type ProjectMove } from "@/components/tt/projects/index/actions";
import { TTButton } from "@/components/tt/primitives";
import { ProjectStatusPill } from "@/components/tt/projects/index/status-pill";
import type { ProjectRowModel } from "@/data/projects/index-projection";
import type { RoadmapIdentity } from "@/data/roadmap-index";

export interface IdentityLookup {
  (company: string): RoadmapIdentity;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="tt-eyebrow">{label}</p>
      <div className="mt-1 text-[13px] leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

export function LineageLine({ row }: { row: ProjectRowModel }) {
  if (!row.lineage.fromRoadmap) {
    return (
      <p className="text-[12px] text-muted-foreground">Started in Projects · No roadmap attached</p>
    );
  }
  const milestone = row.lineage.milestoneOrdinal
    ? `Milestone ${row.lineage.milestoneOrdinal}`
    : "Approved milestone";
  const line = `Roadmap → ${milestone}`;
  return row.lineage.roadmapId ? (
    <Link
      to="/modules/roadmap/$roadmapId"
      params={{ roadmapId: row.lineage.roadmapId }}
      search={{ view: "overview" as const }}
      className="text-[12px] text-royal underline-offset-4 hover:underline"
    >
      {line}
    </Link>
  ) : (
    <p className="text-[12px] text-muted-foreground">{line}</p>
  );
}

export function ProjectCard({
  row,
  identity,
  onMove,
  onOpenDetails,
  pending,
  error,
}: {
  row: ProjectRowModel;
  identity: RoadmapIdentity;
  onMove: ProjectMove;
  onOpenDetails: (row: ProjectRowModel) => void;
  pending?: boolean;
  error?: string | null;
}) {
  const progress = row.progress;
  return (
    <article className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-royal/30">
      <div className="flex items-start gap-4">
        <CompanyMark
          name={row.lineage.company}
          websiteUrl={identity.websiteUrl ?? ""}
          logoUrl={identity.logoUrl ?? null}
          themeColor={identity.themeColor ?? null}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {row.lineage.company}
            </p>
            <ProjectStatusPill status={row.status} />
          </div>

          <h3 className="mt-1.5 text-[15px] font-medium text-foreground">
            <Link
              to="/modules/projects/$projectId"
              params={{ projectId: row.project.id }}
              className="underline-offset-4 hover:underline"
            >
              {row.project.name}
            </Link>
          </h3>
          <div className="mt-1">
            <LineageLine row={row} />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,0.6fr))_minmax(0,1fr)]">
            <Field label="Outcome">
              <p className="line-clamp-2 text-muted-foreground">{row.outcome}</p>
            </Field>
            <Field label="Owner">{row.ownerLabel}</Field>
            <Field label="Due">{row.due}</Field>
            <Field label="Progress">
              {progress.counted ? (
                <>
                  <span
                    aria-hidden
                    className="block h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                  >
                    <span
                      className={`block h-full rounded-full ${
                        row.status === "blocked" ? "bg-destructive" : "bg-royal"
                      }`}
                      style={{ width: `${Math.max(progress.percent, 4)}%` }}
                    />
                  </span>
                  <span className="mt-1 block text-[12px] text-muted-foreground">
                    {progress.line}
                  </span>
                </>
              ) : (
                <span className="text-[12px] text-muted-foreground">{progress.line}</span>
              )}
            </Field>
          </div>

          {row.blocker ? (
            <p className="mt-3 border-l-2 border-destructive pl-3 text-[13px] text-foreground">
              Blocked: {row.blocker}
              {row.blockedForDays !== null && row.blockedForDays > 0
                ? ` · ${row.blockedForDays} day${row.blockedForDays === 1 ? "" : "s"}`
                : ""}
            </p>
          ) : row.waitingOn ? (
            <p className="mt-3 border-l-2 border-warning pl-3 text-[13px] text-foreground">
              Waiting on {row.waitingOn}
            </p>
          ) : row.currentWork ? (
            <p className="mt-3 text-[13px] text-muted-foreground">
              <span className="text-foreground">Current:</span> {row.currentWork}
            </p>
          ) : null}

          <p className="mt-2 text-[12px] text-muted-foreground">{row.because}</p>

          <ProjectActionBar
            className="mt-3 border-t border-border pt-3"
            project={row.project}
            onMove={onMove}
            pending={pending ?? false}
            error={error ?? null}
          />
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
          <TTButton size="sm" variant="secondary" onClick={() => onOpenDetails(row)}>
            Details
          </TTButton>
          <TTButton asChild size="sm" variant="quiet">
            <Link to="/modules/projects/$projectId" params={{ projectId: row.project.id }}>
              Open project
            </Link>
          </TTButton>
          {row.lineage.roadmapId ? (
            <Link
              to="/modules/roadmap/$roadmapId"
              params={{ roadmapId: row.lineage.roadmapId }}
              search={{ view: "overview" as const }}
              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open roadmap
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
