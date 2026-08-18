/**
 * The project details drawer.
 *
 * Opened from a card, it answers the small questions without leaving the room:
 * who it is for, who carries it, what was agreed, when it is due, where it
 * stands, and the delivery items recorded against it. Nothing is invented; if
 * a thing was never recorded, the drawer says so.
 */

import { Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";

import { CompanyMark } from "@/components/tt/company-identity";
import { TTButton } from "@/components/tt/primitives";
import { ProjectActionBar, type ProjectMove } from "@/components/tt/projects/index/actions";
import { LineageLine } from "@/components/tt/projects/index/project-card";
import { ProjectStatusPill } from "@/components/tt/projects/index/status-pill";
import type { ProjectRowModel } from "@/data/projects/index-projection";
import type { RoadmapIdentity } from "@/data/roadmap-index";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="tt-eyebrow">{label}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-foreground">{value}</p>
    </div>
  );
}

export function ProjectDrawer({
  row,
  identity,
  onClose,
  onMove,
  pending,
  error,
}: {
  row: ProjectRowModel | null;
  identity: RoadmapIdentity;
  onClose: () => void;
  onMove: ProjectMove;
  pending: boolean;
  error: string | null;
}) {
  if (!row) return null;
  const project = row.project;
  const items = project.deliveryItems ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close details"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${project.name} details`}
        className="h-full w-full max-w-[480px] overflow-y-auto border-l border-border bg-card p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <CompanyMark
              name={row.lineage.company}
              websiteUrl={identity.websiteUrl ?? ""}
              logoUrl={identity.logoUrl ?? null}
              themeColor={identity.themeColor ?? null}
              size="md"
            />
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {row.lineage.company}
              </p>
              <h2 className="mt-1 font-display text-lg leading-tight text-foreground">
                {project.name}
              </h2>
              <div className="mt-1.5">
                <LineageLine row={row} />
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ProjectStatusPill status={row.status} />
          <span className="text-[12px] text-muted-foreground">{row.because}</span>
        </div>

        {row.blocker ? (
          <p className="mt-4 border-l-2 border-destructive pl-3 text-[13px] text-foreground">
            Blocked: {row.blocker}
            {row.blockedForDays !== null && row.blockedForDays > 0
              ? ` · ${row.blockedForDays} day${row.blockedForDays === 1 ? "" : "s"}`
              : ""}
          </p>
        ) : row.waitingOn ? (
          <p className="mt-4 border-l-2 border-warning pl-3 text-[13px] text-foreground">
            Waiting on {row.waitingOn}
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Row label="Company" value={row.lineage.company} />
          <Row label="Owner" value={row.ownerLabel} />
          <Row label="Due date" value={row.due} />
          <Row label="Current state" value={row.healthLabel} />
        </div>

        <div className="mt-4 space-y-4">
          <Row label="Outcome (Point B)" value={row.outcome} />
          <Row label="Where things stand (Point A)" value={project.pointA || "Not recorded yet."} />
          {row.currentWork ? <Row label="Current work" value={row.currentWork} /> : null}
        </div>

        <section className="mt-6" aria-label="Delivery items">
          <p className="tt-eyebrow">Delivery items</p>
          {items.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              No delivery items recorded, so progress cannot be counted yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
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
                  <span className={item.done ? "text-muted-foreground line-through" : "text-foreground"}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-muted-foreground">{row.progress.line}</p>
        </section>

        <section className="mt-6 space-y-2" aria-label="Move this work">
          <p className="tt-eyebrow">Move this work</p>
          <ProjectActionBar project={project} onMove={onMove} pending={pending} error={error} />
        </section>

        <div className="mt-6 flex flex-wrap gap-2">
          <TTButton asChild size="sm">
            <Link to="/modules/projects/$projectId" params={{ projectId: project.id }}>
              Open full project
            </Link>
          </TTButton>
          {row.lineage.roadmapId ? (
            <TTButton asChild size="sm" variant="secondary">
              <Link
                to="/modules/roadmap/$roadmapId"
                params={{ roadmapId: row.lineage.roadmapId }}
                search={{ view: "overview" as const }}
              >
                Open roadmap
              </Link>
            </TTButton>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
