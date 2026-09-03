/**
 * Where an approved decision goes next.
 *
 * Approvals owns the decision, never the execution. Once a person authorises
 * something, the only thing this layer does is hand the decision to the room
 * that owns the work, in a form that room already understands, and record what
 * happened. It does not send, publish, deploy or write business truth itself.
 *
 * Three honest outcomes, and no fourth:
 *
 *   - `queued`      the owning room accepted the decision and will act on it.
 *   - `unavailable` the decision is recorded and the execution path does not
 *                   exist yet. Said plainly rather than dressed up as success.
 *   - `failed`      the handover was attempted and refused.
 *
 * "Approved" and "executed" therefore stay separate states, always.
 */

import type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalType,
  DownstreamResult,
} from "@/domain/approvals";

export interface DownstreamAdapter {
  id: string;
  /** The room that will carry the work afterwards. */
  owningRoom: string;
  /** Plain language, shown before the person decides. */
  describe: (request: ApprovalRequest) => string;
  /** Where the person goes to watch it happen. */
  route: (request: ApprovalRequest) => string;
  /**
   * What the approved decision becomes. Pure: it returns the result to record
   * rather than performing the work, so the decision trail is written by one
   * writer, in one place, in one transition.
   */
  handover: (request: ApprovalRequest, at: string) => DownstreamResult;
  /** The state the request moves to after a successful handover. */
  nextStatus: Extract<ApprovalStatus, "queued" | "executed">;
}

function reference(request: ApprovalRequest): string {
  return `${request.sourceEntity.type}:${request.sourceEntity.id}`;
}

const COMMS_DRAFT: DownstreamAdapter = {
  id: "comms.send_queue",
  owningRoom: "Comms",
  describe: () => "The approved message joins the Comms send queue against this relationship.",
  route: (request) => `/modules/comms?relationship=${encodeURIComponent(request.sourceEntity.id)}`,
  nextStatus: "queued",
  handover: (request, at) => ({
    state: "queued",
    adapterId: "comms.send_queue",
    because: "Approved for sending. Comms owns the send and will record it on the timeline.",
    reference: reference(request),
    at,
  }),
};

const SCOUT_RELATIONSHIP: DownstreamAdapter = {
  id: "scout.comms_handoff",
  owningRoom: "Comms",
  describe: () =>
    "The person is handed to Comms as a relationship to develop. No message is sent by this act.",
  route: (request) => `/modules/scout?prospect=${encodeURIComponent(request.sourceEntity.id)}`,
  nextStatus: "queued",
  handover: (request, at) => ({
    state: "queued",
    adapterId: "scout.comms_handoff",
    because:
      "Approved for development. Scout marks the prospect ready and Comms opens the relationship.",
    reference: reference(request),
    at,
  }),
};

const BLOG_BATCH: DownstreamAdapter = {
  id: "content.publish_queue",
  owningRoom: "Content",
  describe: () =>
    "Approved posts join the publishing queue in order. Anything you left unapproved stays put.",
  route: () => "/modules/studio",
  nextStatus: "queued",
  handover: (request, at) => ({
    state: "queued",
    adapterId: "content.publish_queue",
    because: `${request.batch?.approved ?? 0} of ${request.batch?.total ?? 0} posts approved for publishing.`,
    reference: reference(request),
    at,
  }),
};

const ROADMAP_CHANGE: DownstreamAdapter = {
  id: "roadmap.decision_log",
  owningRoom: "Roadmap",
  describe: () => "The change is written to the roadmap decision log with your reasoning attached.",
  route: () => "/modules/roadmap",
  nextStatus: "queued",
  handover: (request, at) => ({
    state: "queued",
    adapterId: "roadmap.decision_log",
    because: "Approved. Roadmap records the change and the reason it was made.",
    reference: reference(request),
    at,
  }),
};

const DELIVERY_CHANGE: DownstreamAdapter = {
  id: "projects.change_order",
  owningRoom: "Projects",
  describe: () =>
    "The change becomes a change order on the project. Scheduling and client sign-off stay in Projects.",
  route: (request) => `/modules/projects?project=${encodeURIComponent(request.sourceEntity.id)}`,
  nextStatus: "queued",
  handover: (request, at) => ({
    state: "queued",
    adapterId: "projects.change_order",
    because: "Approved. Projects raises the change order against this engagement.",
    reference: reference(request),
    at,
  }),
};

const ADAPTERS: Record<ApprovalType, DownstreamAdapter> = {
  comms_draft: COMMS_DRAFT,
  scout_relationship: SCOUT_RELATIONSHIP,
  blog_batch: BLOG_BATCH,
  roadmap_change: ROADMAP_CHANGE,
  delivery_change: DELIVERY_CHANGE,
};

export function downstreamAdapter(type: ApprovalType): DownstreamAdapter {
  return ADAPTERS[type];
}

/** Every registered type has a path home. Asserted by test, not by hope. */
export function registeredDownstreamTypes(): ApprovalType[] {
  return Object.keys(ADAPTERS) as ApprovalType[];
}
