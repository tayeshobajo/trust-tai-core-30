/**
 * The reads a client page makes into the rooms that own its truth.
 *
 * Each read is a plain question to one owning room. Nothing here writes,
 * infers, or falls back to an empty answer: a read that fails throws, and the
 * page shows that section as unreadable instead of quietly empty.
 */

import { supabaseActivity } from "@/data/supabase/activities";
import { approvalsSchemaReady, approvalsService } from "@/data/supabase/approvals-service";
import { roadmapService } from "@/data/supabase/roadmap-service";
import type { ActivityEvent } from "@/domain/activity";
import type { ApprovalRequest } from "@/domain/approvals";
import type { ID } from "@/domain/entities";
import type { Roadmap, RoadmapDecision, RoadmapStage } from "@/domain/roadmap";

export interface ClientRoadmapRead {
  roadmaps: Roadmap[];
  stagesByRoadmap: Record<ID, RoadmapStage[]>;
  openDecisions: RoadmapDecision[];
}

/** Roadmap, its stages and its open decisions, read together so the outcome line is whole. */
export async function readClientRoadmaps(organizationId: ID): Promise<ClientRoadmapRead> {
  const [roadmaps, stagesByRoadmap, openDecisions] = await Promise.all([
    roadmapService.list(organizationId),
    roadmapService.stagesByRoadmap(organizationId),
    roadmapService.openDecisions(organizationId),
  ]);
  return { roadmaps, stagesByRoadmap, openDecisions };
}

export type ClientApprovalsRead =
  | { ready: false }
  | { ready: true; requests: ApprovalRequest[] };

/**
 * Decisions filed against this client's canonical ids. A ledger that is not
 * in this database is reported as not ready, never as an empty list.
 */
export async function readClientApprovals(
  organizationId: ID,
  entityIds: ID[],
): Promise<ClientApprovalsRead> {
  const ready = await approvalsSchemaReady(organizationId);
  if (!ready) return { ready: false };
  const requests = await approvalsService.listForEntities({ organizationId }, entityIds);
  return { ready: true, requests };
}

/** How far back the History view reads before it stops. */
export const CLIENT_HISTORY_READ_LIMIT = 200;

/**
 * The shared stream, read directly so a failure is a failure. The page keeps
 * only events whose subject or related entities are this client's own ids.
 */
export async function readClientHistory(organizationId: ID): Promise<ActivityEvent[]> {
  return supabaseActivity.list({ organizationId, limit: CLIENT_HISTORY_READ_LIMIT });
}

/** Events that name any of this client's canonical ids, newest first. */
export function eventsAbout(events: ActivityEvent[], ids: ID[]): ActivityEvent[] {
  const wanted = new Set(ids);
  return events.filter(
    (event) =>
      wanted.has(event.subject.id) ||
      (event.related ?? []).some((related) => wanted.has(related.id)),
  );
}
