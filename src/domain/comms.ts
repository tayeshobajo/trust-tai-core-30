/**
 * Trust Tai OS, Comms contracts.
 *
 * Comms is not an inbox. It is the room where relationships are kept alive on
 * purpose: one queue, one state per person, one truthful reason to reconnect.
 *
 * Three rules hold everywhere:
 *  1. Observed, inferred, and decided never blend into one sentence.
 *  2. A stage only changes because a person changed it.
 *  3. Nothing is sent. Comms drafts and holds; a human approves and sends.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import { intentOf, type RelationshipIntent } from "./comms-interactions";

/* -------------------------------------------------------------- lifecycle */

export type RelationshipStage =
  | "new"
  | "researching"
  | "ready_to_reach"
  | "reached_out"
  | "in_conversation"
  | "meeting_set"
  | "opportunity"
  | "client"
  | "nurture"
  | "dormant"
  | "archived";

export const RELATIONSHIP_STAGES: RelationshipStage[] = [
  "new",
  "researching",
  "ready_to_reach",
  "reached_out",
  "in_conversation",
  "meeting_set",
  "opportunity",
  "client",
  "nurture",
  "dormant",
  "archived",
];

export const STAGE_LABEL: Record<RelationshipStage, string> = {
  new: "New",
  researching: "Researching",
  ready_to_reach: "Ready to reach",
  reached_out: "Reached out",
  in_conversation: "In conversation",
  meeting_set: "Meeting set",
  opportunity: "Opportunity",
  client: "Client",
  nurture: "Nurture",
  dormant: "Dormant",
  archived: "Archived",
};

export type RelationshipSource = "scout_handoff" | "in_person" | "manual" | "inbound";

export const SOURCE_LABEL: Record<RelationshipSource, string> = {
  scout_handoff: "From Scout",
  in_person: "Met in person",
  manual: "Added by hand",
  inbound: "They reached out",
};

/* ----------------------------------------------------------------- memory */

/** One remembered thing, kept in its own tier with its evidence. */
export interface MemoryItem {
  label: string;
  value: string;
  tier: "observed" | "inferred" | "decided";
  evidence: EvidenceRef[];
  at: ISODateTime;
  /**
   * Optional structured extras. These live inside the same jsonb row, so
   * commitments and relationship memory need no new table.
   */
  category?: string;
  due?: ISODateTime;
  status?: "open" | "kept" | "released";
  owner?: string;
  /** Plain-words provenance, for example "Added by Tai". */
  addedBy?: string;
}


export const TIER_LABEL: Record<MemoryItem["tier"], string> = {
  observed: "Observed",
  inferred: "Inferred",
  decided: "Decided",
};

/* ---------------------------------------------------------- relationship */

export interface Relationship {
  id: ID;
  organizationId: ID;
  contactId?: ID;
  clientId?: ID;
  prospectId?: ID;
  fullName: string;
  companyName?: string;
  email?: string;
  stage: RelationshipStage;
  ownerUserId?: ID;
  source: RelationshipSource;
  metAt?: ISODateTime;
  metWhere?: string;
  lastTouchAt?: ISODateTime;
  nextAction?: string;
  responseDueAt?: ISODateTime;
  followUpDueAt?: ISODateTime;
  observed: MemoryItem[];
  inferred: MemoryItem[];
  decided: MemoryItem[];
  metadata: Record<string, unknown>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* --------------------------------------------------------------- threads */

export type ThreadChannel =
  | "email"
  | "call"
  | "meeting"
  | "message"
  | "note"
  | "linkedin"
  | "text";

export const CHANNEL_LABEL: Record<ThreadChannel, string> = {
  email: "Email",
  call: "Phone call",
  meeting: "Meeting",
  message: "Message",
  note: "Note",
  linkedin: "LinkedIn",
  text: "Text",
};


export type ThreadState = "open" | "waiting_on_us" | "waiting_on_them" | "scheduled" | "closed";

export const THREAD_STATE_LABEL: Record<ThreadState, string> = {
  open: "Open",
  waiting_on_us: "Waiting on us",
  waiting_on_them: "Waiting on them",
  scheduled: "Scheduled",
  closed: "Closed",
};

/* ---------------------------------------------------------------- touches */

export interface Touch {
  id: ID;
  organizationId: ID;
  relationshipId: ID;
  threadId?: ID;
  channel: ThreadChannel;
  direction: "inbound" | "outbound";
  occurredAt: ISODateTime;
  summary: string;
  body?: string;
  loggedBy?: ID;
  /**
   * How this entry came to read as it does: who logged it, and any later
   * correction or retraction. Read with `readTouchRecord`.
   */
  provenance?: Record<string, unknown>;
}

/* ----------------------------------------------------------------- drafts */

export type DraftReviewState = "draft" | "needs_human_review" | "approved" | "sent" | "discarded";

export const REVIEW_STATE_LABEL: Record<DraftReviewState, string> = {
  draft: "Draft",
  needs_human_review: "Needs human review",
  approved: "Approved",
  sent: "Marked as sent",
  discarded: "Discarded",
};

export interface CommsDraft {
  id: ID;
  organizationId: ID;
  relationshipId: ID;
  intent: string;
  register: string;
  subject?: string;
  body: string;
  voiceVersion: number;
  reviewState: DraftReviewState;
  rationale: Record<string, unknown>;
  evidence: EvidenceRef[];
  createdBy?: ID;
  createdAt: ISODateTime;
}

/* -------------------------------------------------------------- reminders */

/**
 * A reminder must rest on something true. No reason code, no reminder, Comms
 * never manufactures a message to keep a cadence alive.
 */
export type ReasonCode =
  | "commitment_made"
  | "no_reply_after_days"
  | "event_follow_up"
  | "company_signal"
  | "anniversary_of_meeting"
  | "role_change_observed"
  | "inbound_unanswered";

export const REASON_LABEL: Record<ReasonCode, string> = {
  commitment_made: "We said we would do something",
  no_reply_after_days: "No reply since we wrote",
  event_follow_up: "Met in person, never followed up",
  company_signal: "Something changed at their company",
  anniversary_of_meeting: "A year since we met",
  role_change_observed: "Their role changed",
  inbound_unanswered: "They wrote and we have not replied",
};

export interface Reminder {
  id: ID;
  organizationId: ID;
  relationshipId: ID;
  reasonCode: ReasonCode;
  reasonText: string;
  evidence: EvidenceRef[];
  dueAt?: ISODateTime;
  state: "pending" | "acted" | "dismissed";
  createdAt: ISODateTime;
}

/* ----------------------------------------------------------------- timing */

/** How overdue this relationship is against its own commitments. */
export type DueState = "overdue" | "today" | "this_week" | "clear" | "dormant";

export const DUE_LABEL: Record<DueState, string> = {
  overdue: "Overdue",
  today: "Due today",
  this_week: "Due this week",
  clear: "Clear",
  dormant: "Gone quiet",
};

/** A relationship with no touch in this long has gone quiet. */
export const DORMANT_AFTER_DAYS = 45;

const DAY = 86_400_000;

export function daysBetween(from: ISODateTime, to: ISODateTime | Date): number {
  const a = new Date(from).getTime();
  const b = to instanceof Date ? to.getTime() : new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / DAY);
}

function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/**
 * The one timing read the queue and the workspace share.
 *
 * A response we owe outranks a follow-up we planned; a stale relationship with
 * nothing due is quiet, not late.
 */
export function dueState(relationship: Relationship, now: Date = new Date()): DueState {
  const due = [relationship.responseDueAt, relationship.followUpDueAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b)[0];

  if (due !== undefined) {
    const today = startOfDay(now);
    if (due < today) return "overdue";
    if (due < today + DAY) return "today";
    if (due < today + 7 * DAY) return "this_week";
  }

  if (relationship.stage === "archived" || relationship.stage === "client") return "clear";

  const last = relationship.lastTouchAt ?? relationship.createdAt;
  if (daysBetween(last, now) >= DORMANT_AFTER_DAYS) return "dormant";

  return "clear";
}

/* --------------------------------------------------------------- segments */

/**
 * Operating segment: which room of the relationship workspace a person
 * belongs to. Derived from the same record, never stored — one person, one
 * relationship memory, many conversations. The segment moves only when a
 * person changes the stage.
 *
 * Classification is deliberately conservative so legacy rows never vanish
 * or masquerade:
 *  - A graduated stage (meeting set, opportunity, client) always means the
 *    client room, whatever the origin. Graduation updates this same record.
 *  - An explicit nurture stage means nurture, whatever the origin.
 *  - Scout/outbound origin stays nurture until it graduates — a handoff is a
 *    decision to develop someone, not proof of an established relationship.
 *  - Everything else — met in person, added by hand, they reached out — is
 *    an established relationship and belongs with clients.
 */
export type RelationshipSegment = "client" | "nurture";

export const SEGMENT_LABEL: Record<RelationshipSegment, string> = {
  client: "Clients",
  nurture: "Nurture",
};

/** Stages that prove a relationship has become established work. */
export const ESTABLISHED_STAGES: readonly RelationshipStage[] = [
  "meeting_set",
  "opportunity",
  "client",
];

/**
 * Early lifecycle stages are development evidence, whatever the origin: a
 * person who is new, being researched, or freshly reached out to is someone
 * we are developing, not an established relationship — even when we met them
 * in person or they wrote to us first.
 */
export const EARLY_STAGES: readonly RelationshipStage[] = [
  "new",
  "researching",
  "ready_to_reach",
  "reached_out",
];

/**
 * Explicit intents that describe an established relationship rather than a
 * development target. Only an intent a human actually set counts; a display
 * fallback never classifies anyone.
 */
const ESTABLISHED_INTENTS: readonly RelationshipIntent[] = [
  "active_client",
  "past_client",
  "partner",
  "referral",
  "community",
  "vendor",
  "personal",
];

/**
 * Which operating room a relationship belongs to, derived — never stored.
 *
 * Classification follows current relationship reality, not the door the
 * person entered through. Established evidence (a linked client record, a
 * graduated stage, an explicit established intent) wins first; development
 * evidence (explicit nurture, prospect intent, Scout provenance, an early
 * stage) comes next; and the safe fallback keeps legacy established/manual
 * rows visible in Clients rather than letting anyone vanish.
 */
export function relationshipSegment(relationship: Relationship): RelationshipSegment {
  // Established evidence wins: a real client stays a client even when the row
  // still carries Scout provenance or an early stage.
  if (relationship.clientId) return "client";
  if (ESTABLISHED_STAGES.includes(relationship.stage)) return "client";
  const intent = intentOf(relationship);
  if (intent && ESTABLISHED_INTENTS.includes(intent)) return "client";

  // Development evidence: deliberately chosen to develop, not yet established.
  if (relationship.stage === "nurture") return "nurture";
  if (intent === "prospect") return "nurture";
  if (relationship.prospectId) return "nurture";
  if (relationship.source === "scout_handoff") return "nurture";
  if (EARLY_STAGES.includes(relationship.stage)) return "nurture";

  // Safe fallback: `in_conversation` and `dormant` are contextual, so a legacy
  // row with no development evidence stays visible in the client room.
  return "client";
}

/**
 * Whether "Move to Nurture" is a safe, honest action: the person sits in the
 * client room only by contextual fallback, not by hard evidence (a linked
 * client record, a graduated stage, or an explicit established intent).
 * Moving sets an explicit nurture stage on the same record — nothing is
 * copied or lost, and graduation back stays one click away. A real client is
 * never offered the move, because their stage is evidence, not a label.
 */
export function canMoveToNurture(relationship: Relationship): boolean {
  if (relationshipSegment(relationship) !== "client") return false;
  if (relationship.clientId) return false;
  if (ESTABLISHED_STAGES.includes(relationship.stage)) return false;
  const intent = intentOf(relationship);
  if (intent && ESTABLISHED_INTENTS.includes(intent)) return false;
  return true;
}

/** Stages where silence is a problem rather than a choice. */
export const ACTIVE_STAGES: RelationshipStage[] = [
  "new",
  "researching",
  "ready_to_reach",
  "reached_out",
  "in_conversation",
  "meeting_set",
  "opportunity",
];

export function isActive(relationship: Relationship): boolean {
  return ACTIVE_STAGES.includes(relationship.stage);
}
