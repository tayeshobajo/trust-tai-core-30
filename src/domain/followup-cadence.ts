/**
 * Trust Tai OS — follow-up cadence decision (the Relationships line, "Follow up").
 *
 * Pure. Given what actually happened on a relationship (our last outbound, any
 * inbound after it, where the cadence currently sits), decide the ONE next move.
 * No I/O, no sends, no drafting. The sweep does the acting; this only judges.
 *
 * Governing laws (inherited from relationship-development.ts + comms.ts):
 *  1. A follow-up must rest on something true. If they replied, we stop — a reply
 *     is the relationship going somewhere, and automation ends where relationship
 *     begins.
 *  2. We never manufacture a message to keep a cadence alive past its end. Two
 *     touches, then cold.
 *  3. Silence is the only trigger. No last-outbound, no follow-up.
 *
 * Cadence (Tai, 2026-09-20): touch 1 at day 4, touch 2 at day 10, cold after
 * touch 2 unanswered. Chosen for a senior/busy ICP where rapid follow-up reads
 * as pushy.
 */

/** Days after the anchored outbound that each touch becomes due. */
export const FOLLOWUP_TOUCH_DAYS = [4, 10] as const;
export const FOLLOWUP_MAX_TOUCHES = FOLLOWUP_TOUCH_DAYS.length; // 2

export type FollowupState = "active" | "replied" | "cold";

export type FollowupAction =
  | "none"
  | "draft_touch_1"
  | "draft_touch_2"
  | "mark_replied"
  | "mark_cold";

/** What the sweep knows about one relationship at decision time. */
export interface FollowupInput {
  /** Our most recent outbound message time. Null = we never reached out. */
  lastOutboundAt: Date | null;
  /** True if any inbound arrived strictly after lastOutboundAt. */
  repliedAfterLastOutbound: boolean;
  /** Touch number already drafted for the CURRENT anchor: 0, 1, or 2. */
  lastTouchNo: number;
  /** Current persisted state, if we have one. */
  currentState?: FollowupState;
  /** Evaluation time (injected for testability). */
  now: Date;
}

export interface FollowupDecision {
  action: FollowupAction;
  /** Touch number this decision produces a draft for (1|2), else null. */
  touchNo: number | null;
  /** When the NEXT touch becomes due, for persisting next_due_at. Null if terminal. */
  nextDueAt: Date | null;
  /** Plain-language reason, becomes comms_reminders.reason_text / audit. */
  reason: string;
  /** Whole days since the anchored outbound (for evidence). */
  daysSinceOutbound: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** When does touch N (1-based) come due, relative to the anchor outbound? */
export function dueAtForTouch(anchor: Date, touchNo: number): Date | null {
  const idx = touchNo - 1;
  const days = FOLLOWUP_TOUCH_DAYS[idx];
  if (days === undefined) return null;
  return new Date(anchor.getTime() + days * DAY_MS);
}

/**
 * The single next move for one relationship. Deterministic and total: every
 * input maps to exactly one action.
 */
export function decideFollowup(input: FollowupInput): FollowupDecision {
  const { lastOutboundAt, repliedAfterLastOutbound, lastTouchNo, now } = input;

  // Law 3: silence is the only trigger. Never reached out → nothing to follow up.
  if (!lastOutboundAt) {
    return {
      action: "none",
      touchNo: null,
      nextDueAt: null,
      reason: "No outbound on record; nothing to follow up.",
      daysSinceOutbound: null,
    };
  }

  const days = wholeDaysBetween(lastOutboundAt, now);

  // Law 1: they came back. Stop. The relationship is now a conversation, not a cadence.
  if (repliedAfterLastOutbound) {
    return {
      action: "mark_replied",
      touchNo: null,
      nextDueAt: null,
      reason: "They replied after our last message; follow-up cadence ends.",
      daysSinceOutbound: days,
    };
  }

  // Law 2: cadence exhausted. Two touches drafted, still silence → cold.
  if (lastTouchNo >= FOLLOWUP_MAX_TOUCHES) {
    return {
      action: "mark_cold",
      touchNo: null,
      nextDueAt: null,
      reason: `No reply after ${FOLLOWUP_MAX_TOUCHES} follow-ups; marking cold.`,
      daysSinceOutbound: days,
    };
  }

  // Which touch is next, and is it due yet?
  const nextTouchNo = lastTouchNo + 1; // 1 or 2
  const threshold = FOLLOWUP_TOUCH_DAYS[nextTouchNo - 1] ?? Number.POSITIVE_INFINITY;

  if (days < threshold) {
    // Not due yet — the next touch's due date is what we persist.
    return {
      action: "none",
      touchNo: null,
      nextDueAt: dueAtForTouch(lastOutboundAt, nextTouchNo),
      reason: `Awaiting reply; touch ${nextTouchNo} due at day ${threshold} (currently day ${days}).`,
      daysSinceOutbound: days,
    };
  }

  // Due. Draft this touch; next_due_at points at the touch AFTER this one (or null).
  const followingDue =
    nextTouchNo < FOLLOWUP_MAX_TOUCHES
      ? dueAtForTouch(lastOutboundAt, nextTouchNo + 1)
      : null;

  return {
    action: nextTouchNo === 1 ? "draft_touch_1" : "draft_touch_2",
    touchNo: nextTouchNo,
    nextDueAt: followingDue,
    reason: `No reply ${days} days after our message; drafting follow-up ${nextTouchNo}.`,
    daysSinceOutbound: days,
  };
}
