/**
 * What happens after a person says yes.
 *
 * Approvals records the judgment. The room that owns the work performs it,
 * through the same governed path it already had, and this module is only the
 * hand-off between the two. It never sends, publishes or writes a room's
 * business truth itself, and it never lets "approved" quietly mean "done".
 *
 * The states stay separate, always:
 *
 *   approved   a person authorised it
 *   queued     the owning room accepted the decision and holds the work
 *   executed   the room performed it and has provider evidence
 *
 * For Comms that boundary is deliberate. Comms already defines pressing Send
 * as the explicit human send authorisation, with a provider receipt as the
 * only proof of execution. Approving copy here marks the draft approved in
 * Comms and stops. Nothing leaves the building without a person in Comms.
 */

import type { ApprovalRequest, ApprovalStatus, DownstreamResult } from "@/domain/approvals";
import type { HandoffDraft } from "@/domain/comms-handoff";
import type { ID } from "@/domain/entities";

import { downstreamAdapter } from "./downstream";

export interface ExecutionContext {
  organizationId: ID;
  userId: ID;
}

export interface ExecutionOutcome {
  result: DownstreamResult;
  /** Only set when the owning room really accepted the work. */
  nextStatus?: Extract<ApprovalStatus, "queued" | "executed">;
}

function reference(request: ApprovalRequest): string {
  return `${request.sourceEntity.type}:${request.sourceEntity.id}`;
}

function payloadString(request: ApprovalRequest, key: string): string {
  const value = request.payload?.[key];
  return typeof value === "string" ? value : "";
}

/* ------------------------------------------------------------------ Comms */

/**
 * Approved copy becomes an approved draft in Comms, and nothing more.
 * No message row, no timeline touch, no provider call.
 */
async function executeCommsDraft(
  request: ApprovalRequest,
  context: ExecutionContext,
  at: string,
): Promise<ExecutionOutcome> {
  const draftId = payloadString(request, "draftId");
  if (!draftId) {
    return {
      result: {
        state: "unavailable",
        adapterId: "comms.send_queue",
        because:
          "This request was raised without a Comms draft reference, so there is nothing for Comms to hold. The decision is recorded.",
        reference: reference(request),
        at,
      },
    };
  }

  const { loadCommsDraft } = await import("./sources");
  const { commsService } = await import("@/data/supabase/comms-service");
  const { draft, relationship } = await loadCommsDraft(draftId, context.organizationId);

  if (draft.reviewState === "sending" || draft.reviewState === "sent") {
    return {
      result: {
        state: "failed",
        adapterId: "comms.send_queue",
        because: `Comms already moved this draft to ${draft.reviewState.replace(/_/g, " ")}. The approval is recorded but was not applied.`,
        reference: reference(request),
        at,
      },
    };
  }
  if (draft.reviewState === "discarded") {
    return {
      result: {
        state: "failed",
        adapterId: "comms.send_queue",
        because: "That draft was discarded in Comms, so the approval could not be applied.",
        reference: reference(request),
        at,
      },
    };
  }

  if (draft.reviewState !== "approved") {
    await commsService.setDraftState(draft, "approved", relationship, {
      organizationId: context.organizationId,
      userId: context.userId,
    });
  }

  return {
    result: {
      state: "queued",
      adapterId: "comms.send_queue",
      because:
        "The copy is approved in Comms. Sending is still an explicit human act in Comms, and only a provider receipt will mark it sent.",
      reference: `comms_draft:${draft.id}`,
      at,
    },
    nextStatus: "queued",
  };
}

/* ------------------------------------------------------------------ Scout */

/**
 * An approved prospect is handed to Comms through Scout's own handoff, which
 * is already idempotent: the same prospect never opens a second relationship,
 * and no message is sent by the act of handing over.
 */
async function executeScoutRelationship(
  request: ApprovalRequest,
  context: ExecutionContext,
  at: string,
): Promise<ExecutionOutcome> {
  const raw = request.payload?.["handoff"];
  if (!raw || typeof raw !== "object") {
    return {
      result: {
        state: "unavailable",
        adapterId: "scout.comms_handoff",
        because:
          "Scout did not attach a prepared brief to this request, so Comms has nothing to open the relationship with. The decision is recorded.",
        reference: reference(request),
        at,
      },
    };
  }

  const handoff = raw as unknown as HandoffDraft;
  const { scoutService } = await import("@/data/supabase/scout-service");
  const { relationshipId } = await scoutService.routeToComms(handoff, {
    organizationId: context.organizationId,
    userId: context.userId,
  });

  return {
    result: {
      state: "queued",
      adapterId: "scout.comms_handoff",
      because:
        "Scout handed the prospect to Comms as a relationship to develop, with the brief intact. Nothing was sent.",
      reference: `comms_relationship:${relationshipId}`,
      at,
    },
    nextStatus: "queued",
  };
}

/* ---------------------------------------------------------------- Roadmap */

/**
 * An approved roadmap change is resolved through Roadmap's own decision log,
 * the same call the room makes when a person answers the question inside it.
 * Approvals never writes roadmap truth directly.
 */
async function executeRoadmapChange(
  request: ApprovalRequest,
  context: ExecutionContext,
  at: string,
): Promise<ExecutionOutcome> {
  const decisionId = payloadString(request, "decisionId");
  if (!decisionId) {
    return {
      result: {
        state: "unavailable",
        adapterId: "roadmap.decision_log",
        because:
          "This request was raised without a roadmap decision reference, so there is nothing for Roadmap to resolve. The decision is recorded.",
        reference: reference(request),
        at,
      },
    };
  }

  const { roadmapService } = await import("@/data/supabase/roadmap-service");
  const open = await roadmapService.openDecisions(context.organizationId);
  const decision = open.find((entry) => entry.id === decisionId);

  if (!decision) {
    return {
      result: {
        state: "failed",
        adapterId: "roadmap.decision_log",
        because:
          "Roadmap has already resolved that question, so the approval was recorded but not applied.",
        reference: `roadmap_decision:${decisionId}`,
        at,
      },
    };
  }

  await roadmapService.resolveDecision(
    decision,
    "approved",
    request.sourceEntity.label ?? "Roadmap",
    { organizationId: context.organizationId, userId: context.userId },
    request.decision?.reason || "Approved in Approvals.",
  );

  return {
    result: {
      state: "accepted",
      adapterId: "roadmap.decision_log",
      because: "Roadmap recorded the change and the reason it was made, with your name on it.",
      reference: `roadmap_decision:${decision.id}`,
      at,
    },
    nextStatus: "executed",
  };
}

/* --------------------------------------------------------------- dispatch */

/**
 * Hand an approved decision to the room that owns the work.
 *
 * Rooms without a real execution path fall back to the declared adapter, which
 * says plainly what would happen rather than pretending it did.
 */
export async function executeApprovedRequest(
  request: ApprovalRequest,
  context: ExecutionContext,
): Promise<ExecutionOutcome> {
  const at = new Date().toISOString();

  if (request.approvalType === "comms_draft") return executeCommsDraft(request, context, at);
  if (request.approvalType === "scout_relationship") {
    return executeScoutRelationship(request, context, at);
  }
  if (request.approvalType === "roadmap_change") return executeRoadmapChange(request, context, at);

  const adapter = downstreamAdapter(request.approvalType);
  const result = adapter.handover(request, at);
  return {
    result,
    ...(result.state === "queued" ? { nextStatus: adapter.nextStatus } : {}),
  };
}
