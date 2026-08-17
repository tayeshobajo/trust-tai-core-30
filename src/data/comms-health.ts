/**
 * Conversation health, derived.
 *
 * Deterministic and explainable: the same records always produce the same read,
 * and every classification can say why in a sentence a person would say out
 * loud. Nothing is guessed by a model, and nothing is written back.
 *
 * The language rule matters as much as the logic: health describes the
 * conversation ("this has slowed"), never the human ("they are disengaged").
 */

import {
  type ConversationHealth,
  type ConversationHealthStatus,
  type Momentum,
  type NextMoveStatus,
  type RelationshipStrengthRead,
  type ResponseCadence,
  type StrengthBand,
  type WaitingOn,
} from "@/domain/comms-health";
import { daysBetween, type Relationship, type Touch } from "@/domain/comms";

/** A follow-up we planned is "due soon" inside this window. */
export const DUE_SOON_DAYS = 3;
/** Silence after we wrote becomes a real signal here. */
export const UNANSWERED_AFTER_DAYS = 10;
/** A conversation with nothing at all for this long has simply gone quiet. */
export const QUIET_AFTER_DAYS = 30;
/** An interaction is "meaningful" if it was a real exchange, not a note to self. */
const MEANINGFUL_CHANNELS = new Set(["email", "call", "meeting", "message", "linkedin"]);

function ms(value?: string): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function ordered(touches: Touch[]): Touch[] {
  return [...touches].sort(
    (a, b) => (ms(a.occurredAt) ?? 0) - (ms(b.occurredAt) ?? 0),
  );
}

/* -------------------------------------------------------------- cadence */

/**
 * How the exchange has been flowing. Compares how long their recent replies
 * took against the earlier ones; slower is a fact about the thread, not a fault.
 */
export function responseCadence(touches: Touch[], now: Date = new Date()): ResponseCadence {
  const list = ordered(touches).filter((touch) => MEANINGFUL_CHANNELS.has(touch.channel));
  if (list.length === 0) return "unknown";

  const last = list[list.length - 1]!;
  const lastInbound = [...list].reverse().find((touch) => touch.direction === "inbound");
  if (last.direction === "outbound") {
    const since = daysBetween(last.occurredAt, now);
    if (since >= UNANSWERED_AFTER_DAYS) return "unanswered";
  }
  if (!lastInbound) return list.length > 1 ? "unanswered" : "unknown";

  // Reply gaps: our message followed by their next reply.
  const gaps: number[] = [];
  for (let index = 0; index < list.length - 1; index += 1) {
    const current = list[index]!;
    const next = list[index + 1]!;
    if (current.direction === "outbound" && next.direction === "inbound") {
      gaps.push(daysBetween(current.occurredAt, next.occurredAt));
    }
  }
  if (gaps.length === 0) return "unknown";
  if (gaps.length === 1) return gaps[0]! <= 2 ? "responsive" : "steady";

  const latest = gaps[gaps.length - 1]!;
  const earlier = gaps.slice(0, -1);
  const average = earlier.reduce((total, gap) => total + gap, 0) / earlier.length;
  if (latest > Math.max(average * 2, average + 3)) return "slowing";
  if (latest <= 2 && average <= 3) return "responsive";
  return "steady";
}

/* ------------------------------------------------------------- momentum */

export function momentumOf(
  relationship: Relationship,
  touches: Touch[],
  now: Date = new Date(),
): Momentum {
  const list = ordered(touches);
  const last = list[list.length - 1];
  const lastAt = last?.occurredAt ?? relationship.lastTouchAt;
  if (!lastAt) return list.length === 0 ? "stalled" : "cooling";

  const since = daysBetween(lastAt, now);
  const recent = list.filter((touch) => daysBetween(touch.occurredAt, now) <= 21).length;

  if (since <= 7 && recent >= 2) return "warm";
  if (since <= 14) return "stable";
  if (since <= QUIET_AFTER_DAYS) return "cooling";
  return "stalled";
}

/* ------------------------------------------------------------ next move */

export function nextMoveStatusOf(
  relationship: Relationship,
  now: Date = new Date(),
): NextMoveStatus {
  const due = [relationship.responseDueAt, relationship.followUpDueAt]
    .map(ms)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)[0];

  const hasAction = Boolean(relationship.nextAction?.trim());
  if (due !== undefined) {
    if (due < now.getTime()) return "overdue";
    if (due - now.getTime() <= DUE_SOON_DAYS * 86_400_000) return "due_soon";
    return "set";
  }
  if (hasAction) return "set";
  if (relationship.stage === "archived" || relationship.stage === "client") return "not_needed";
  return "none";
}

/* ------------------------------------------------------------- waiting */

export function waitingOnOf(relationship: Relationship, touches: Touch[]): WaitingOn {
  const list = ordered(touches).filter((touch) => MEANINGFUL_CHANNELS.has(touch.channel));
  const last = list[list.length - 1];
  if (relationship.responseDueAt) return "needs_us";
  if (last?.direction === "inbound") return "needs_us";
  if (last?.direction === "outbound") return "waiting_on_them";
  if (!relationship.nextAction?.trim()) return "no_next_move";
  return "needs_us";
}

/* --------------------------------------------------------------- health */

/**
 * The one health read the inbox, the room, and the rail all share.
 *
 * Order of judgement: something overdue or repeatedly unanswered outranks a
 * slowdown, which outranks plain silence. Quiet is the absence of a signal, not
 * a bad one.
 */
export function conversationHealth(
  relationship: Relationship,
  touches: Touch[],
  now: Date = new Date(),
): ConversationHealth {
  const list = ordered(touches);
  const meaningful = list.filter((touch) => MEANINGFUL_CHANNELS.has(touch.channel));
  const last = list[list.length - 1];
  const lastInbound = [...list].reverse().find((touch) => touch.direction === "inbound");
  const lastOutbound = [...list].reverse().find((touch) => touch.direction === "outbound");

  const lastActivityAt = last?.occurredAt ?? relationship.lastTouchAt;
  const cadence = responseCadence(touches, now);
  const momentum = momentumOf(relationship, touches, now);
  const nextMove = nextMoveStatusOf(relationship, now);
  const waitingOn = waitingOnOf(relationship, touches);
  const sinceActivity = lastActivityAt ? daysBetween(lastActivityAt, now) : undefined;

  const reasons: string[] = [];
  let status: ConversationHealthStatus = "healthy";

  const overdueDays = (() => {
    const due = [relationship.responseDueAt, relationship.followUpDueAt]
      .map(ms)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b)[0];
    if (due === undefined || due >= now.getTime()) return 0;
    return Math.floor((now.getTime() - due) / 86_400_000);
  })();

  // Consecutive outbound messages with no reply after them.
  const unanswered = (() => {
    let count = 0;
    for (let index = meaningful.length - 1; index >= 0; index -= 1) {
      const touch = meaningful[index]!;
      if (touch.direction === "inbound") break;
      count += 1;
    }
    return count;
  })();

  if (relationship.stage === "archived") {
    return {
      relationshipId: relationship.id,
      status: "quiet",
      score: 50,
      ...(lastActivityAt ? { lastActivityAt } : {}),
      ...(lastInbound ? { lastReplyAt: lastInbound.occurredAt } : {}),
      responseCadence: cadence,
      nextMoveStatus: "not_needed",
      momentum,
      waitingOn: "no_next_move",
      reasons: ["This conversation has been archived, so nothing is expected of it."],
      computedAt: now.toISOString(),
    };
  }

  /* ------------------------------------------------------------ at risk */
  if (overdueDays >= DUE_SOON_DAYS) {
    status = "at_risk";
    reasons.push(
      `A follow-up here has been outstanding for ${overdueDays} day${overdueDays === 1 ? "" : "s"}.`,
    );
  }
  if (
    unanswered >= 2 &&
    lastOutbound &&
    daysBetween(lastOutbound.occurredAt, now) >= UNANSWERED_AFTER_DAYS
  ) {
    status = "at_risk";
    reasons.push(
      `We have written ${unanswered} times without a reply coming back on this thread.`,
    );
  }
  if (momentum === "stalled" && meaningful.length >= 2) {
    status = "at_risk";
    reasons.push("This conversation was active and has since stopped moving.");
  }

  /* ---------------------------------------------------- needs attention */
  if (status === "healthy") {
    if (nextMove === "overdue") {
      status = "needs_attention";
      reasons.push("The next move on this conversation has slipped past its date.");
    } else if (nextMove === "due_soon") {
      status = "needs_attention";
      reasons.push("The next move here is due in the next few days.");
    } else if (cadence === "slowing") {
      status = "needs_attention";
      reasons.push("Replies on this thread are taking longer than they used to.");
    } else if (cadence === "unanswered") {
      status = "needs_attention";
      reasons.push("We wrote last and nothing has come back yet.");
    } else if (
      nextMove === "none" &&
      meaningful.length > 0 &&
      sinceActivity !== undefined &&
      sinceActivity <= QUIET_AFTER_DAYS
    ) {
      status = "needs_attention";
      reasons.push("Something real happened here and no next move has been set.");
    }
  }

  /* -------------------------------------------------------------- quiet */
  if (
    status === "healthy" &&
    (meaningful.length === 0 || (sinceActivity !== undefined && sinceActivity > QUIET_AFTER_DAYS))
  ) {
    status = "quiet";
    reasons.push(
      meaningful.length === 0
        ? "Nothing has happened on this conversation yet."
        : `There has been no activity for ${sinceActivity} days, and nothing is outstanding.`,
    );
  }

  if (status === "healthy" && reasons.length === 0) {
    reasons.push("Recent activity, a normal rhythm, and nothing overdue.");
  }

  /* -------------------------------------------------------------- score */
  let score = 70;
  if (status === "healthy") score = 85;
  if (status === "needs_attention") score = 55;
  if (status === "at_risk") score = 28;
  if (status === "quiet") score = 45;
  if (momentum === "warm") score += 8;
  if (momentum === "cooling") score -= 5;
  if (momentum === "stalled") score -= 8;
  if (cadence === "responsive") score += 5;
  if (cadence === "unanswered") score -= 5;
  score = Math.max(0, Math.min(100, score));

  return {
    relationshipId: relationship.id,
    status,
    score,
    ...(lastActivityAt ? { lastActivityAt } : {}),
    ...(lastInbound ? { lastReplyAt: lastInbound.occurredAt } : {}),
    responseCadence: cadence,
    nextMoveStatus: nextMove,
    momentum,
    waitingOn,
    reasons,
    computedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------- strength */

/**
 * How substantial the relationship is, independent of how the current thread is
 * going. A long, two-sided history stays strong through a quiet month.
 */
export function relationshipStrength(
  relationship: Relationship,
  touches: Touch[],
  now: Date = new Date(),
): RelationshipStrengthRead {
  const list = ordered(touches);
  const inbound = list.filter((touch) => touch.direction === "inbound").length;
  const outbound = list.filter((touch) => touch.direction === "outbound").length;
  const met = list.some((touch) => touch.channel === "meeting" || touch.channel === "call");
  const remembered =
    relationship.observed.length + relationship.inferred.length + relationship.decided.length;
  const ageDays = daysBetween(relationship.createdAt, now);

  let score = 0;
  score += Math.min(30, list.length * 4);
  score += Math.min(25, inbound * 8);
  score += met ? 15 : 0;
  score += Math.min(15, remembered * 3);
  score += relationship.metWhere || relationship.metAt ? 8 : 0;
  score += ageDays >= 90 && list.length > 0 ? 7 : 0;
  score = Math.max(0, Math.min(100, score));

  const band: StrengthBand =
    score >= 60 ? "established" : score >= 38 ? "building" : score >= 20 ? "early" : "untested";

  const factors = [
    { label: "Exchanges", value: `${list.length} on record` },
    { label: "Two-sided", value: inbound > 0 ? `${inbound} from them` : "Nothing back yet" },
    { label: "Met live", value: met ? "Call or meeting on record" : "Not yet" },
    { label: "What we know", value: remembered > 0 ? `${remembered} remembered` : "Nothing yet" },
  ];
  void outbound;

  return {
    relationshipId: relationship.id,
    band,
    score,
    factors,
    computedAt: now.toISOString(),
  };
}
