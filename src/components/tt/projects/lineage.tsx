/**
 * The full chain a piece of delivery came down.
 *
 * Company → Roadmap → Milestone → Project → delivery items → outcome. Delivery
 * without provenance is just activity, so the chain is shown whole, and where
 * a link was never recorded it says so rather than inventing one.
 */

import { Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";

import type { ProjectRowModel } from "@/data/projects/index-projection";

function Step({ label, value, to }: { label: string; value: string; to?: { roadmapId: string } }) {
  return (
    <div className="min-w-0">
      <p className="tt-eyebrow">{label}</p>
      {to ? (
        <Link
          to="/modules/roadmap/$roadmapId"
          params={{ roadmapId: to.roadmapId }}
          search={{ view: "overview" as const }}
          className="mt-1 block truncate text-[13px] text-royal underline-offset-4 hover:underline"
        >
          {value}
        </Link>
      ) : (
        <p className="mt-1 truncate text-[13px] text-foreground">{value}</p>
      )}
    </div>
  );
}

function Arrow() {
  return <ChevronRight aria-hidden className="mt-4 hidden size-4 shrink-0 text-border md:block" />;
}

export function ProjectLineage({ row }: { row: ProjectRowModel }) {
  const { lineage, project } = row;
  const items = project.deliveryItems ?? [];
  const milestone = lineage.milestoneName
    ? `${lineage.milestoneOrdinal ? `${lineage.milestoneOrdinal} · ` : ""}${lineage.milestoneName}`
    : lineage.fromRoadmap
      ? "Approved milestone"
      : "No milestone, started here";

  return (
    <section aria-label="Where this work came from" className="tt-surface space-y-4 p-6">
      <div className="flex flex-wrap items-start gap-4 md:flex-nowrap md:gap-3">
        <Step label="Company" value={lineage.company} />
        <Arrow />
        <Step
          label="Roadmap"
          value={lineage.roadmapId ? "Company roadmap" : "No roadmap attached"}
          {...(lineage.roadmapId ? { to: { roadmapId: lineage.roadmapId } } : {})}
        />
        <Arrow />
        <Step label="Milestone" value={milestone} />
        <Arrow />
        <Step label="Project" value={project.name} />
        <Arrow />
        <Step
          label="Delivery"
          value={items.length === 0 ? "No items recorded" : row.progress.line}
        />
        <Arrow />
        <Step label="Outcome" value={row.outcome} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[13px]">
        {row.blocker ? (
          <span className="rounded-full border border-destructive/25 bg-destructive/8 px-2.5 py-1 text-[12px] text-destructive">
            Blocked: {row.blocker}
            {row.blockedForDays !== null && row.blockedForDays > 0
              ? ` · ${row.blockedForDays} day${row.blockedForDays === 1 ? "" : "s"}`
              : ""}
          </span>
        ) : row.waitingOn ? (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[12px] text-warning">
            Waiting on {row.waitingOn}
          </span>
        ) : null}
        <span
          className={`rounded-full border px-2.5 py-1 text-[12px] ${
            row.dueInDays !== null && row.dueInDays < 0
              ? "border-destructive/25 bg-destructive/8 text-destructive"
              : "border-border bg-secondary text-muted-foreground"
          }`}
        >
          Due next: {row.due}
        </span>
      </div>

      {items.length > 0 ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-[13px]">
              <span
                aria-hidden
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                  item.done
                    ? "border-success/40 bg-success/15 text-success"
                    : "border-border text-transparent"
                }`}
              >
                <Check className="size-3" />
              </span>
              <span
                className={item.done ? "text-muted-foreground line-through" : "text-foreground"}
              >
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
