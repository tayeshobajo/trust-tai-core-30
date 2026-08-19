/**
 * Backfilling the execution ownership law over what is already persisted.
 *
 * The law is deterministic at read time, but rows written before it existed
 * can still say "Studio builds the dashboard" in their boundary sentence, and
 * an execution link can still point engineering work at the wrong room. This
 * module decides, purely, what would have to change. Nothing here writes.
 *
 * Two things stay untouched, on purpose:
 *   - what a milestone promises. Only the room name in the sentence is fixed.
 *   - links that are already complete or withdrawn. That is history, not state.
 */

import {
  EXECUTION_ROOM_LABEL,
  classifyExecutionOwner,
  correctExecutionBoundary,
  type ExecutionRoom,
  type OwnershipRead,
} from "./execution-ownership";

export interface BackfillMilestone {
  id: string;
  roadmapId: string;
  name: string;
  whatWeBuild: string;
  executionBoundary: string;
}

export interface BackfillLink {
  id: string;
  milestoneId: string;
  owningApp: ExecutionRoom;
  status: "requested" | "accepted" | "in_progress" | "complete" | "withdrawn";
}

/** Links whose ownership is history and must not be rewritten. */
export const FROZEN_LINK_STATUSES = ["complete", "withdrawn"] as const;

export interface OwnershipCorrection {
  milestoneId: string;
  roadmapId: string;
  name: string;
  owner: OwnershipRead;
  boundaryBefore: string;
  boundaryAfter: string;
  boundaryChanged: boolean;
  linkId: string | null;
  linkOwnerBefore: ExecutionRoom | null;
  linkOwnerAfter: ExecutionRoom | null;
  linkChanged: boolean;
  /** Set when a wrong link exists but may not be touched. */
  frozenBecause: string | null;
}

export interface OwnershipBackfillPlan {
  corrections: OwnershipCorrection[];
  /** Only the rows that would actually be written. */
  changes: OwnershipCorrection[];
  frozen: OwnershipCorrection[];
  counts: {
    milestones: number;
    boundaries: number;
    links: number;
    frozen: number;
  };
}

function frozen(status: BackfillLink["status"]): boolean {
  return (FROZEN_LINK_STATUSES as readonly string[]).includes(status);
}

/**
 * Read every milestone through the law and report the gap between what is
 * stored and what the law says. Idempotent: running it on a corrected set
 * produces an empty change list.
 */
export function planOwnershipBackfill(
  milestones: BackfillMilestone[],
  links: BackfillLink[],
): OwnershipBackfillPlan {
  const linkByMilestone = new Map(links.map((link) => [link.milestoneId, link]));

  const corrections = milestones.map((milestone) => {
    const owner = classifyExecutionOwner(
      milestone.name,
      milestone.whatWeBuild,
      milestone.executionBoundary,
    );
    const boundaryBefore = (milestone.executionBoundary ?? "").trim();
    const boundaryAfter = correctExecutionBoundary(boundaryBefore, owner.primary);
    const link = linkByMilestone.get(milestone.id) ?? null;
    const wrongLink = link !== null && link.owningApp !== owner.primary;
    const canWriteLink = wrongLink && !frozen(link.status);

    return {
      milestoneId: milestone.id,
      roadmapId: milestone.roadmapId,
      name: milestone.name,
      owner,
      boundaryBefore,
      boundaryAfter,
      boundaryChanged: boundaryAfter !== boundaryBefore,
      linkId: link?.id ?? null,
      linkOwnerBefore: link?.owningApp ?? null,
      linkOwnerAfter: canWriteLink ? owner.primary : (link?.owningApp ?? null),
      linkChanged: canWriteLink,
      frozenBecause:
        wrongLink && !canWriteLink
          ? `This handoff to ${EXECUTION_ROOM_LABEL[link.owningApp]} is already ${link.status}, so it stays as history. ${EXECUTION_ROOM_LABEL[owner.primary]} owns any new work.`
          : null,
    } satisfies OwnershipCorrection;
  });

  const changes = corrections.filter((entry) => entry.boundaryChanged || entry.linkChanged);
  const frozenRows = corrections.filter((entry) => entry.frozenBecause !== null);

  return {
    corrections,
    changes,
    frozen: frozenRows,
    counts: {
      milestones: milestones.length,
      boundaries: changes.filter((entry) => entry.boundaryChanged).length,
      links: changes.filter((entry) => entry.linkChanged).length,
      frozen: frozenRows.length,
    },
  };
}

/** One plain sentence a person can read before authorising the write. */
export function describeBackfillPlan(plan: OwnershipBackfillPlan): string {
  if (plan.counts.milestones === 0) return "There are no milestones to read.";
  if (plan.changes.length === 0) {
    return `All ${plan.counts.milestones} milestones already name the room that owns them.`;
  }
  const parts: string[] = [];
  if (plan.counts.boundaries > 0) {
    parts.push(
      `${plan.counts.boundaries} boundary ${plan.counts.boundaries === 1 ? "sentence names" : "sentences name"} the wrong room`,
    );
  }
  if (plan.counts.links > 0) {
    parts.push(`${plan.counts.links} open ${plan.counts.links === 1 ? "handoff points" : "handoffs point"} at the wrong room`);
  }
  return `${parts.join(", and ")}. ${plan.counts.frozen > 0 ? `${plan.counts.frozen} settled ${plan.counts.frozen === 1 ? "handoff stays" : "handoffs stay"} as history.` : ""}`.trim();
}
