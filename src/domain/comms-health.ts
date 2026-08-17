/**
 * Trust Tai OS — Conversation health contracts.
 *
 * Health is a read about a *thread*, never a verdict about a person. It is
 * derived from records that already exist (touches, due dates, next moves) and
 * is never persisted: nothing here is business truth, only a way of seeing it.
 *
 * Conversation health = how this conversation is moving.
 * Relationship strength = how substantial the relationship is overall.
 * They are deliberately separate reads.
 */

import type { ISODateTime } from "./entities";

export type ConversationHealthStatus = "healthy" | "needs_attention" | "at_risk" | "quiet";

export const HEALTH_LABEL: Record<ConversationHealthStatus, string> = {
  healthy: "Healthy",
  needs_attention: "Needs attention",
  at_risk: "At risk",
  quiet: "Quiet",
};

/** Order used for filters and for sorting attention to the top. */
export const HEALTH_ORDER: ConversationHealthStatus[] = [
  "healthy",
  "needs_attention",
  "at_risk",
  "quiet",
];

export type ResponseCadence = "responsive" | "steady" | "slowing" | "unanswered" | "unknown";

export const CADENCE_LABEL: Record<ResponseCadence, string> = {
  responsive: "They reply quickly",
  steady: "Normal rhythm",
  slowing: "Replies are slowing",
  unanswered: "No reply since we wrote",
  unknown: "Not enough history",
};

export type Momentum = "warm" | "stable" | "cooling" | "stalled";

export const MOMENTUM_LABEL: Record<Momentum, string> = {
  warm: "Warm",
  stable: "Stable",
  cooling: "Cooling",
  stalled: "Stalled",
};

export type WaitingOn = "needs_us" | "waiting_on_them" | "no_next_move";

export const WAITING_LABEL: Record<WaitingOn, string> = {
  needs_us: "Needs us",
  waiting_on_them: "Waiting on them",
  no_next_move: "No next move",
};

export type NextMoveStatus = "none" | "set" | "due_soon" | "overdue" | "not_needed";

export const NEXT_MOVE_LABEL: Record<NextMoveStatus, string> = {
  none: "No next move set",
  set: "Next move set",
  due_soon: "Due soon",
  overdue: "Overdue",
  not_needed: "Nothing outstanding",
};

/**
 * The derived read. `score` is a rough 0–100 comfort reading, not a metric to
 * optimise; it exists so a row can be sorted, never so a person can be graded.
 */
export interface ConversationHealth {
  relationshipId: string;
  status: ConversationHealthStatus;
  score: number;
  lastActivityAt?: ISODateTime;
  lastReplyAt?: ISODateTime;
  responseCadence: ResponseCadence;
  nextMoveStatus: NextMoveStatus;
  momentum: Momentum;
  waitingOn: WaitingOn;
  /** Plain-language, thread-phrased. Never a claim about the person. */
  reasons: string[];
  computedAt: ISODateTime;
}

/* --------------------------------------------------------------- strength */

export type StrengthBand = "established" | "building" | "early" | "untested";

export const STRENGTH_LABEL: Record<StrengthBand, string> = {
  established: "Established",
  building: "Building",
  early: "Early",
  untested: "Untested",
};

export interface RelationshipStrengthRead {
  relationshipId: string;
  band: StrengthBand;
  score: number;
  /** What the band rests on, in plain language. */
  factors: { label: string; value: string }[];
  computedAt: ISODateTime;
}
