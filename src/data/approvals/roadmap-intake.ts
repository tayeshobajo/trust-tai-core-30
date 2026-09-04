/**
 * Roadmap intake: an open question is a proposed change waiting for a name.
 *
 * Roadmap keeps its own truth. The decision log in `roadmap_decisions` is that
 * truth, and it stays that way: Approvals never becomes a second roadmap. All
 * this adapter does is notice that a change has been proposed and nobody has
 * yet said yes, and put that judgment where every other judgment waits.
 *
 * What travels with the card is what a person needs to decide honestly: the
 * position today, the position proposed, what it touches, why it was proposed
 * and where the proposal came from. Nothing is invented, and nothing about the
 * roadmap is changed by submitting.
 *
 * Approving calls Roadmap's own `resolveDecision`, the same path a person uses
 * inside the room. The approval records the authority; Roadmap records the
 * change.
 */

import { roadmapService } from "@/data/supabase/roadmap-service";
import { approvalsService, type ApprovalsContext } from "@/data/supabase/approvals-service";
import type { ApprovalRequest } from "@/domain/approvals";
import type { Roadmap, RoadmapDecision, RoadmapStage } from "@/domain/roadmap";

import { roadmapChangeSubmission } from "./submissions";
import type { IntakeReport } from "./intake";

/** Where the roadmap stands today, said plainly rather than left blank. */
function currentPosition(roadmap: Roadmap, stage: RoadmapStage | null): string {
  if (stage) return `${stage.title} is ${stage.state.replace(/_/g, " ")}.`;
  if (roadmap.nextMove) return roadmap.nextMove.action;
  if (roadmap.pointB) return roadmap.pointB.statement;
  return "No position is recorded on this roadmap yet.";
}

/** The change being proposed, only ever Roadmap's own words. */
function proposedPosition(decision: RoadmapDecision): string {
  if (decision.recommendation) return decision.recommendation;
  if (decision.options.length > 0) return decision.options.join(" or ");
  return decision.question;
}

/**
 * The governed submission for one open roadmap decision.
 *
 * Pure translation: no reads, no writes, and no judgment of its own.
 */
export function roadmapDecisionSubmissionFor(
  decision: RoadmapDecision,
  roadmap: Roadmap,
  stage: RoadmapStage | null = null,
) {
  return roadmapChangeSubmission({
    roadmapId: roadmap.id,
    decisionId: decision.id,
    changeTitle: decision.question,
    rationale:
      decision.recommendationBecause ||
      decision.whyItMatters ||
      "Roadmap raised this as a change that needs a person.",
    before: currentPosition(roadmap, stage),
    after: proposedPosition(decision),
    affects: [
      ...(stage ? [stage.title] : []),
      ...(roadmap.subjectLabel ? [roadmap.subjectLabel] : []),
      ...(decision.labels ?? []),
    ].slice(0, 6),
    evidence: decision.evidence,
    provenance: {
      roadmapId: roadmap.id,
      roadmapTitle: roadmap.title,
      ...(decision.stageId ? { stageId: decision.stageId } : {}),
      proposedAt: decision.createdAt,
      ...(decision.ownerUserId ? { proposedBy: decision.ownerUserId } : {}),
    },
  });
}

/**
 * The canonical Roadmap hook. An open decision becomes a waiting judgment;
 * a resolved one is left alone.
 *
 * Idempotent by source key: the same decision never becomes two cards, and a
 * re-submission after the proposal changes updates the existing card instead.
 */
export async function submitRoadmapDecisionForApproval(
  decision: RoadmapDecision,
  roadmap: Roadmap,
  context: ApprovalsContext,
  stage: RoadmapStage | null = null,
): Promise<ApprovalRequest | null> {
  if (decision.status !== "open") return null;
  return approvalsService.submit(context, roadmapDecisionSubmissionFor(decision, roadmap, stage));
}

/** The same hook where a failed queue write must not break the Roadmap room. */
export async function submitRoadmapDecisionQuietly(
  decision: RoadmapDecision,
  roadmap: Roadmap,
  context: ApprovalsContext,
  stage: RoadmapStage | null = null,
): Promise<ApprovalRequest | null> {
  try {
    return await submitRoadmapDecisionForApproval(decision, roadmap, context, stage);
  } catch (error) {
    console.warn("[approvals] roadmap decision intake deferred:", (error as Error).message);
    return null;
  }
}

/**
 * Bring open roadmap decisions that predate this adapter into the queue.
 *
 * Reads Roadmap's own rows through Roadmap's own service, in three reads
 * rather than one per decision, and leans on the source key so a second run
 * changes nothing.
 */
export async function backfillRoadmapApprovals(
  context: ApprovalsContext,
  options: { limit?: number } = {},
): Promise<IntakeReport> {
  const report: IntakeReport = { scanned: 0, submitted: 0, skipped: 0, failed: 0, errors: [] };

  const [decisions, roadmaps, stagesByRoadmap] = await Promise.all([
    roadmapService.openDecisions(context.organizationId),
    roadmapService.list(context.organizationId),
    roadmapService.stagesByRoadmap(context.organizationId),
  ]);

  const byId = new Map(roadmaps.map((roadmap) => [roadmap.id, roadmap]));
  const open = decisions.slice(0, options.limit ?? 200);
  report.scanned = open.length;

  for (const decision of open) {
    const roadmap = byId.get(decision.roadmapId);
    if (!roadmap) {
      report.skipped += 1;
      continue;
    }
    const stage =
      (stagesByRoadmap[decision.roadmapId] ?? []).find((entry) => entry.id === decision.stageId) ??
      null;
    try {
      const request = await submitRoadmapDecisionForApproval(decision, roadmap, context, stage);
      if (request) report.submitted += 1;
      else report.skipped += 1;
    } catch (failure) {
      report.failed += 1;
      report.errors.push(`${decision.question}: ${(failure as Error).message}`);
    }
  }

  return report;
}
