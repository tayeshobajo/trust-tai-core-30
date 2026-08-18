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

export type ThreadChannel = "email" | "call" | "meeting" | "message" | "note" | "linkedin";

export const CHANNEL_LABEL: Record<ThreadChannel, string> = {
  email: "Email",
  call: "Call",
  meeting: "Meeting",
  message: "Message",
  note: "Note",
  linkedin: "LinkedIn",
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
