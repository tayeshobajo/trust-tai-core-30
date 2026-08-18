/**
 * The heart of the Roadmap index: one horizontal row per company.
 *
 * Five zones, left to right: identity, Point A → Point B, milestone path,
 * current or next milestone, and the way in.
 */

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { CompanyMark } from "@/components/tt/company-identity";
import {
  ROADMAP_DISPLAY_LABEL,
  relativeTime,
  type MilestoneMark,
  type RoadmapDisplayState,
  type RoadmapRowModel,
} from "@/data/roadmap-index";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<RoadmapDisplayState, string> = {
  draft: "border-border bg-secondary text-muted-foreground",
  active: "border-success/25 bg-success/8 text-success",
  needs_decision: "border-warning/30 bg-warning/8 text-warning",
  paused: "border-border bg-secondary text-muted-foreground",
  complete: "border-royal/25 bg-royal/8 text-royal",
};

export function RoadmapStateBadge({ state }: { state: RoadmapDisplayState }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
        STATE_TONE[state],
      )}
    >
      {ROADMAP_DISPLAY_LABEL[state]}
    </span>
  );
}

const DOT: Record<MilestoneMark["state"], string> = {
  done: "border-success bg-success text-primary-foreground",
  current: "border-royal bg-royal text-primary-foreground",
  blocked: "border-warning bg-warning text-primary-foreground",
  future: "border-border bg-card text-muted-foreground",
};

export function RoadmapMilestoneStrip({ milestones }: { milestones: MilestoneMark[] }) {
  if (milestones.length === 0) {
    return <p className="text-[12px] text-muted-foreground">No milestones sequenced yet.</p>;
  }
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-start gap-0">
        {milestones.map((milestone, index) => (
          <li key={milestone.id} className="flex items-start">
            {index > 0 ? (
              <span aria-hidden className="mt-[13px] h-px w-8 shrink-0 bg-border md:w-10" />
            ) : null}
            <span className="flex w-[86px] flex-col items-center gap-1.5 text-center md:w-[96px]">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border font-mono text-[10px]",
                  DOT[milestone.state],
                )}
              >
                {milestone.ordinal}
              </span>
              <span
                className={cn(
                  "line-clamp-2 text-[11px] leading-tight",
                  milestone.state === "future" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {milestone.title}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PointColumn({
  label,
  value,
  tier,
}: {
  label: string;
  value: string;
  tier?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="tt-eyebrow">{label}</p>
      <p className="mt-1 text-[13px] leading-snug text-foreground">{value}</p>
      {tier ? <p className="mt-0.5 text-[11px] italic text-muted-foreground">{tier}</p> : null}
    </div>
  );
}

export function RoadmapRow({ row }: { row: RoadmapRowModel }) {
  const focus = row.current ?? row.next;
  return (
    <article className="rounded-xl border border-border bg-card p-4 transition-shadow duration-200 hover:shadow-sm sm:p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(180px,1fr)_minmax(220px,1.3fr)_minmax(0,2fr)_auto] xl:items-center">
        {/* A, identity */}
        <div className="flex min-w-0 items-start gap-3">
          <CompanyMark
            name={row.company}
            websiteUrl={row.identity.websiteUrl ?? ""}
            themeColor={row.identity.themeColor ?? null}
            logoUrl={row.identity.logoUrl ?? null}
            size="sm"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-medium text-foreground">{row.company}</h3>
              <RoadmapStateBadge state={row.state} />
            </div>
            {row.builtFromScout ? (
              <p className="mt-1 text-[11px] text-muted-foreground">Built from Scout</p>
            ) : null}
          </div>
        </div>

        {/* B, Point A → Point B */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
          <PointColumn label="Point A" value={row.pointA} />
          <ArrowRight aria-hidden className="mt-5 size-4 shrink-0 text-muted-foreground" />
          <PointColumn
            label="Point B"
            value={row.pointB}
            tier={row.pointBTier === "inferred" ? "Inferred" : undefined}
          />
        </div>

        {/* C + D, the path, and what is live in it */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="tt-eyebrow">
              {row.milestones.length} {row.milestones.length === 1 ? "milestone" : "milestones"}
            </p>
            {focus ? (
              <p className="text-[12px] text-muted-foreground">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-royal">
                  {row.current ? "Current" : "Next"}
                </span>{" "}
                <span className="text-foreground">{focus.title}</span>
              </p>
            ) : null}
          </div>
          <div className="mt-3">
            <RoadmapMilestoneStrip milestones={row.milestones} />
          </div>
        </div>

        {/* E, action, quietly */}
        <div className="flex shrink-0 flex-col items-start gap-1.5 xl:items-end">
          <Link
            to="/modules/roadmap/$roadmapId"
            params={{ roadmapId: row.roadmapId }}
            search={{ view: "overview" as const }}
            className="inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-[13px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open roadmap
          </Link>
          <p className="text-[11px] text-muted-foreground">Owner: {row.ownerLabel}</p>
          <p className="text-[11px] text-muted-foreground">Updated {relativeTime(row.updatedAt)}</p>
        </div>
      </div>
    </article>
  );
}

export function RoadmapList({ rows }: { rows: RoadmapRowModel[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.roadmapId}>
          <RoadmapRow row={row} />
        </li>
      ))}
    </ul>
  );
}
