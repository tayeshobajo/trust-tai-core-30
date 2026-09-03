/**
 * Trust Tai OS, shared activity/event contract.
 *
 * This is a contract, not a message bus. Every app writes the same event shape
 * so cross-app intelligence can read one stream with provenance intact.
 */

import type { EntityRef, EntityType, ID, ISODateTime } from "./entities";

export type ActivityAction =
  | "created"
  | "updated"
  | "status_changed"
  | "assigned"
  | "commented"
  | "completed"
  | "decided"
  | "researched"
  /** Passed from one app to another with its context intact, e.g. Scout → Comms. */
  | "handed_over"
  /** Roadmap: a draft was synthesised from existing shared evidence. */
  | "generated"
  | "approved"
  | "stage_changed"
  | "decision_requested"
  | "decision_resolved"
  | "next_move_changed"
  | "flagged"
  /** Scout: a person drafted a question for review. Nothing was sent. */
  | "question_drafted"
  /** Scout: a person marked a company as worth exploring in Roadmap. */
  | "roadmap_intent"
  /** Scout: deeper relationship research was prepared for a newly eligible
   *  prospect. Research only, nothing was sent and no relationship created. */
  | "relationship_brief_prepared"

  /* --- Settings: identity, membership and application access --- */
  | "invited"
  /** An existing invitation was sent again, cancelled, or emailed. */
  | "invite_resent"
  | "invite_cancelled"
  | "invite_emailed"
  | "access_changed"
  | "deactivated"
  | "reactivated"
  /* --- shared suite vocabulary (see src/domain/events.ts) --- */
  | "qualified"
  | "discovered"
  | "message_received"
  | "promise_created"
  | "milestone_approved"
  | "started"
  | "blocked"
  | "published"
  /** Projects asked a specialist room to take a bounded piece of work. */
  | "routed_to_ops"
  | "routed_to_studio"
  /** Projects took its own ask back, or told the receiving room about it. */
  | "route_withdrawn"
  | "route_notified"
  /** The receiving room's own lifecycle for routed work. */
  | "work_accepted"
  | "work_started"
  | "work_completed"
  /* --- Conductor governance (see src/domain/control-events.ts) ---
   * These describe the Conductor's own approval loop, never a room's truth. */
  | "action_proposed"
  | "action_approved"
  | "action_held"
  | "action_rejected"
  | "action_withdrawn"
  | "action_routed"
  | "action_failed"
  | "action_completed"
  | "action_measured"
  /* --- Website signal boundary (see src/domain/website.ts) ---
   * TrustTai.com owns attention and intake. It reports what arrived and
   * whether it reached a company; it never qualifies anything. */
  /** A completed adaptive intake was received and stored verbatim. */
  | "intake_received"
  /** The intake was resolved onto a canonical Scout company on evidence. */
  | "intake_linked"
  /** Identity was ambiguous, so the intake rests as an unlinked signal. */
  | "intake_held";

/**
 * What an event is *about*. Usually a shared core entity. Two suite rooms
 * Ops and Studio, own work that has no shared entity in Core yet, so they may
 * scope their own lifecycle events to the room. The Conductor scope carries
 * governance history only. This is a naming scope, never a licence to create a
 * parallel entity store.
 */
export type ActivityScope = EntityType | "ops" | "studio" | "conductor" | "website" | "linki";

/** Event name is always `scope.action`, e.g. "project.status_changed". */
export type ActivityName = `${ActivityScope}.${ActivityAction}`;

/** Where an event or fact came from, and how much to trust it. */
export interface Provenance {
  /** App registry id that produced the record, e.g. "ops". */
  appId: ID;
  /** Human actor when present, otherwise the system/automation identifier. */
  actor: { type: "user" | "system" | "intelligence"; id: ID; label?: string };
  observedAt: ISODateTime;
  /** Optional external system reference (webhook id, provider record id). */
  externalRef?: string;
  confidence?: "observed" | "inferred";
}

export interface ActivityEvent {
  id: ID;
  organizationId: ID;
  name: ActivityName;
  subject: EntityRef;
  /** Other entities this event touches, for cross-app joins. */
  related?: EntityRef[];
  summary: string;
  payload?: Record<string, unknown>;
  provenance: Provenance;
  occurredAt: ISODateTime;
}

/** Narrow read surface every app can implement or consume. */
export interface ActivityQuery {
  organizationId: ID;
  names?: ActivityName[];
  subjectType?: EntityType;
  subjectId?: ID;
  appIds?: ID[];
  since?: ISODateTime;
  limit?: number;
}

export interface ActivityStream {
  record(event: Omit<ActivityEvent, "id">): Promise<ActivityEvent>;
  list(query: ActivityQuery): Promise<ActivityEvent[]>;
}
