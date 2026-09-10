/**
 * Roadmap → Projects handoff.
 *
 * Pure, deterministic, and deliberately strict. A milestone becomes work only
 * when a person has already decided it upstream: approved, Decided, unblocked,
 * and carried by someone. Anything short of that is refused with the reason,
 * so nothing enters delivery on a proposal.
 *
 * No context is re-typed here. Point A, Point B, the boundary and the evidence
 * are carried across exactly as Roadmap recorded them.
 */

import { readiness } from "@/data/roadmap-milestones";
import type { EvidenceRef } from "@/domain/confidence";
import type { RoadmapMilestone } from "@/domain/roadmap-intel";
import type { ProjectInput } from "@/domain/projects";

export type HandoffResult = { ok: true; input: ProjectInput } | { ok: false; because: string };

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function evidenceFrom(milestone: RoadmapMilestone): EvidenceRef[] {
  return milestone.evidence
    .filter((ref) => clean(ref.label).length > 0)
    .map((ref) => ({
      label: ref.label,
      kind: clean(ref.url) ? ("page" as const) : ("provider" as const),
      ...(clean(ref.url) ? { url: ref.url } : {}),
    }));
}

/**
 * Turn a Decided milestone into the exact input Projects needs.
 * `subjectLabel` is the company or person the roadmap is for.
 */
export function projectFromMilestone(
  milestone: RoadmapMilestone,
  subjectLabel: string,
  options: { clientId?: string } = {},
): HandoffResult {
  const ready = readiness(milestone);
  if (!ready.ready) {
    return { ok: false, because: ready.because };
  }

  const pointA = clean(milestone.currentGap) || clean(milestone.intendedUser);
  const pointB = clean(milestone.whatWeBuild);
  if (!pointB) {
    return { ok: false, because: "The milestone does not say what would be built." };
  }

  return {
    ok: true,
    input: {
      name: clean(milestone.name) || pointB,
      pointA: pointA || `Nothing is recorded yet about where ${subjectLabel} stands on this.`,
      pointB,
      nextMove: clean(milestone.immediateValue)
        ? `Start with what pays back first: ${clean(milestone.immediateValue)}`
        : "Agree the first shippable step with the owner.",
      ...(milestone.ownerUserId ? { ownerUserId: milestone.ownerUserId } : {}),
      ...(milestone.ownerLabel ? { ownerLabel: milestone.ownerLabel } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      evidence: evidenceFrom(milestone),
      dependencies: milestone.dependencies.filter((entry) => clean(entry).length > 0),
      ...(clean(milestone.executionBoundary)
        ? { executionBoundary: clean(milestone.executionBoundary) }
        : {}),
      origin: {
        kind: "roadmap_milestone",
        roadmapId: milestone.roadmapId,
        milestoneId: milestone.id,
        subjectLabel,
      },
    },
  };
}
