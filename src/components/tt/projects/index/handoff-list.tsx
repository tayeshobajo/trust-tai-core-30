/**
 * Ready from roadmap.
 *
 * Approved milestones that a person decided upstream and that have not become
 * delivery yet. One action each: create the project. A milestone that is not
 * ready says why, out loud, instead of offering a button that would fail.
 */

import { ArrowRight, CheckCircle2 } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";

export interface HandoffRow {
  milestone: RoadmapMilestone;
  company: string;
  ready: boolean;
  because: string;
  /** Set when this milestone already carried work into Projects. */
  existingProjectId?: string;
}

export function RoadmapHandoffs({
  rows,
  pendingId,
  onCreate,
  onOpenProject,
}: {
  rows: HandoffRow[];
  pendingId: string | null;
  onCreate: (row: HandoffRow) => void;
  onOpenProject: (projectId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-5 text-[13px] text-muted-foreground">
        No approved milestones are waiting. Work enters this room only after a person approves it in
        Roadmap.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.milestone.id}
          className="rounded-xl border border-border bg-card px-4 py-4 sm:flex sm:items-start sm:justify-between sm:gap-6"
        >
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {row.company}
            </p>
            <p className="mt-1 truncate text-[15px] text-foreground">{row.milestone.name}</p>
            <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">
              {row.milestone.whatWeBuild || "No build description recorded."}
            </p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {row.milestone.ownerLabel ? `Carried by ${row.milestone.ownerLabel}. ` : ""}
              {row.because}
            </p>
          </div>

          <div className="mt-3 shrink-0 sm:mt-0">
            {row.existingProjectId ? (
              <TTButton
                size="sm"
                variant="secondary"
                onClick={() => onOpenProject(row.existingProjectId as string)}
              >
                <CheckCircle2 aria-hidden className="size-4" />
                Already in delivery
              </TTButton>
            ) : (
              <TTButton
                size="sm"
                disabled={!row.ready || pendingId === row.milestone.id}
                title={row.because}
                onClick={() => onCreate(row)}
              >
                {pendingId === row.milestone.id ? "Opening…" : "Create project"}
                <ArrowRight aria-hidden className="size-4" />
              </TTButton>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
