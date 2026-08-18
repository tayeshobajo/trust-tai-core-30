/**
 * Roadmap detail, moving approved work into execution.
 *
 * Roadmap decides sequence; it never runs delivery. This is a request with a
 * confirmation in front of it: a person chooses which approved milestones move
 * into Projects, and after that the roadmap only reads back what the owning
 * room says. Nothing here changes execution state.
 */

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { TTButton } from "@/components/tt/primitives";
import { DetailSection } from "./parts";
import type { PathMilestone } from "@/data/roadmap/detail/projection";
import {
  EXECUTION_STATUS_LABEL,
  OWNING_APP_LABEL,
  type RoadmapExecutionLink,
} from "@/domain/roadmap-exports";
import type { ExecutionState } from "@/domain/projects";

/**
 * How the owning room's state reads back inside the roadmap. Delivery truth
 * belongs to Projects, so this only translates it, it never overrides it.
 */
export function linkStatusFromProject(state: ExecutionState) {
  if (state === "delivered" || state === "closed") return "complete" as const;
  if (state === "not_started") return "accepted" as const;
  return "in_progress" as const;
}

export function ExecutionHandoffCard({
  path,
  links,
  available,
  busy,
  projectStates,
  onConfirm,
}: {
  path: PathMilestone[];
  links: RoadmapExecutionLink[];
  available: boolean;
  busy: boolean;
  projectStates: Record<string, ExecutionState>;
  onConfirm: (milestones: PathMilestone[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);

  const linkedMilestoneIds = new Set(links.map((link) => link.milestoneId));
  const ready = path.filter((entry) => entry.decided && !linkedMilestoneIds.has(entry.id));
  const running = path.filter((entry) => entry.link);

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  return (
    <DetailSection
      eyebrow="Execution"
      title="Approved work in delivery"
      supporting="Only decided milestones can move, and only when you say so. After that, progress is read-only here."
    >
      {!available ? (
        <p className="text-[13px] text-muted-foreground">
          Execution links are not set up in this backend yet, so handoffs cannot be recorded.
        </p>
      ) : null}

      {running.length > 0 ? (
        <ul className="space-y-2">
          {running.map((entry) => {
            const link = entry.link!;
            const state = link.projectId ? projectStates[link.projectId] : undefined;
            const status = state ? linkStatusFromProject(state) : link.status;
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="text-[14px] text-foreground">
                    {entry.ordinal}. {entry.name}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {OWNING_APP_LABEL[link.owningApp]} · {EXECUTION_STATUS_LABEL[status]}
                  </p>
                </div>
                {link.projectId ? (
                  <Link
                    to="/modules/projects/$projectId"
                    params={{ projectId: link.projectId }}
                    className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                  >
                    Open in Projects
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {ready.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Nothing is waiting to move. A milestone becomes eligible once it is decided.
        </p>
      ) : (
        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <p className="tt-eyebrow">Ready to hand over</p>
          <ul className="space-y-2">
            {ready.map((entry) => (
              <li key={entry.id}>
                <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-[14px]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen.includes(entry.id)}
                    onChange={() => toggle(entry.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-foreground">
                      {entry.ordinal}. {entry.name}
                    </span>
                    {entry.whatWeBuild ? (
                      <span className="mt-1 block text-[13px] text-muted-foreground">
                        {entry.whatWeBuild}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">
            {chosen.length === 0
              ? "Choose what moves. Nothing is handed over until you confirm."
              : `${chosen.length} milestone${chosen.length === 1 ? "" : "s"} will open in Projects, carrying their evidence.`}
          </p>
          <TTButton
            size="sm"
            disabled={chosen.length === 0 || busy || !available}
            onClick={() => {
              onConfirm(ready.filter((entry) => chosen.includes(entry.id)));
              setChosen([]);
            }}
          >
            {busy ? "Opening delivery…" : "Confirm handoff"}
          </TTButton>
        </div>
      )}
    </DetailSection>
  );
}
