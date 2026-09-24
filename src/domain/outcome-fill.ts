/**
 * Outcome fill: the moment the judgment memory learns what happened.
 *
 * The clone must learn from what happened, not from what we hoped happened.
 * Missing data is preferable to falsely attributed data. Three layers stay
 * separate here:
 *
 *   EVENT           what happened. Append-only, extremely confident.
 *   STATE           what is true now. Derived from events, on read.
 *   INTERPRETATION  what it means. A later phase entirely; nothing here.
 *
 * Two levels of outcome, because a reply to a relationship is a fact and a
 * reply to one specific message is a claim that needs evidence:
 *
 *  - RELATIONSHIP level: an inbound message always records one
 *    `relationship_replied` event on the relationship. No attribution
 *    required; the person wrote back, that much is certain.
 *  - TOUCH level: one sent draft may carry a `reply_observed` event, with
 *    its attribution declared honestly:
 *      direct_reply       explicit evidence ties the inbound to this
 *                         outbound (same provider thread).
 *      likely_influenced  no explicit tie; this was the single most recent
 *                         plausible send before the reply. A heuristic,
 *                         and labeled as one.
 *    Everything else stays unattributed: earlier sends remain relationship
 *    history and get no event. Ambiguity (reply predates every send, or
 *    simultaneous candidates) attributes nothing.
 *
 * Silence is an observation, not a verdict. Thirty quiet days append a
 * `no_response_observed_30d` event; a day-47 reply appends after it, both
 * facts survive, and the derived state follows the latest event.
 *
 * Immutability applies to EVENTS: the `outcome_events` array only grows,
 * deduped by message ref, and no event is ever rewritten. The old single
 * `outcome` field stays null forever; state is derived, never stored.
 *
 * Pure and I/O-free. The server module (comms-outcome-fill.server.ts)
 * applies these rules; tests pin them. Outcome records are observational:
 * they record what happened and never trigger a send.
 */

/** Silence becomes an observation only after this many days with no reply. */
export const NO_RESPONSE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TouchAttribution = "direct_reply" | "likely_influenced";

export interface OutcomeEvent {
  kind: "relationship_replied" | "reply_observed" | "no_response_observed_30d";
  observed_at: string;
  channel: string | null;
  /** Pointer to the inbound row: provider message id or touch id. */
  message_ref: string | null;
  /** Touch-level reply events only: how the tie to this send is known. */
  attribution?: TouchAttribution;
  /** direct_reply: "thread_metadata". likely_influenced: "recency_heuristic". */
  evidence?: string;
  reply_latency_ms?: number;
}

/** A parseable moment, or null. Bad timestamps record nothing. */
function momentOf(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The append-only event history off a jsonb home, round trip tolerated. */
export function readOutcomeEvents(stored: unknown): OutcomeEvent[] {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
  const raw = (stored as Record<string, unknown>)["outcome_events"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is OutcomeEvent =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>)["kind"] === "string" &&
      typeof (entry as Record<string, unknown>)["observed_at"] === "string",
  );
}

/** True when this message ref already left an event here. Idempotency. */
function hasEventForMessage(events: OutcomeEvent[], messageRef: string): boolean {
  return events.some((event) => event.message_ref === messageRef);
}

/**
 * Append one event to a jsonb record's history. Returns the updated record,
 * or null when there is nothing lawful to write: no record, or the same
 * message ref already recorded (a redelivered sync pass is a no-op).
 */
export function appendOutcomeEvent(
  stored: unknown,
  event: OutcomeEvent,
): Record<string, unknown> | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  const events = readOutcomeEvents(record);
  if (event.message_ref && hasEventForMessage(events, event.message_ref)) return null;
  return { ...record, outcome_events: [...events, event] };
}

/* --------------------------------------------------------- derived state */

/**
 * STATE, derived on read: the latest event by observed time. A day-47 reply
 * recorded after a day-30 silence observation wins because it is later;
 * neither fact is erased.
 */
export function deriveOutcomeState(stored: unknown): {
  current: "replied" | "no_response_observed_30d" | null;
  events: OutcomeEvent[];
} {
  const events = readOutcomeEvents(stored);
  if (events.length === 0) return { current: null, events };
  const latest = [...events].sort(
    (left, right) => (momentOf(left.observed_at) ?? 0) - (momentOf(right.observed_at) ?? 0),
  )[events.length - 1]!;
  return {
    current: latest.kind === "no_response_observed_30d" ? "no_response_observed_30d" : "replied",
    events,
  };
}

/* -------------------------------------------------------- reply planning */

export interface SendCandidate {
  draftId: string;
  sentAt: string;
  /** The provider thread the send went out on, when the transport said. */
  threadRef: string | null;
  /** The draft's dimensional record, as stored (jsonb round trip). */
  dimensional: unknown;
}

export interface ObservedReply {
  messageRef: string;
  occurredAt: string;
  channel: string | null;
  /** The provider thread the inbound arrived on, when the transport said. */
  threadRef: string | null;
}

export interface PlannedReplyOutcome {
  /** The relationship-level fact, or null when this ref is already recorded. */
  relationshipEvent: OutcomeEvent | null;
  /** At most ONE touch gets an event. Null means unattributed: nothing guessed. */
  touchUpdate: { draftId: string; dimensional: Record<string, unknown> } | null;
}

/**
 * Plan what one observed inbound reply lawfully records.
 *
 * The relationship event is always planned (deduped by message ref). The
 * touch event needs attribution: explicit thread metadata makes a
 * direct_reply; failing that, the single most recent send before the reply
 * is likely_influenced; failing THAT, no touch is marked at all. Two sends
 * at the same instant are ambiguous, and ambiguity attributes nothing.
 */
export function planReplyOutcome(input: {
  relationshipRecord: unknown;
  sends: SendCandidate[];
  reply: ObservedReply;
}): PlannedReplyOutcome {
  const repliedAt = momentOf(input.reply.occurredAt);
  const alreadyRecorded = hasEventForMessage(
    readOutcomeEvents(input.relationshipRecord),
    input.reply.messageRef,
  );
  if (repliedAt === null || alreadyRecorded) {
    return { relationshipEvent: null, touchUpdate: null };
  }

  const relationshipEvent: OutcomeEvent = {
    kind: "relationship_replied",
    observed_at: input.reply.occurredAt,
    channel: input.reply.channel,
    message_ref: input.reply.messageRef,
  };

  /* Only sends that predate the reply and can hold a record are candidates. */
  const candidates = input.sends.filter((send) => {
    const sentAt = momentOf(send.sentAt);
    if (sentAt === null || sentAt > repliedAt) return false;
    return !!send.dimensional && typeof send.dimensional === "object";
  });

  let chosen: SendCandidate | undefined;
  let attribution: TouchAttribution | undefined;
  let evidence: string | undefined;

  /* Explicit evidence first: the inbound arrived on the same provider
     thread one send went out on. That is a direct reply, no guessing. */
  if (input.reply.threadRef) {
    const direct = candidates
      .filter((send) => send.threadRef && send.threadRef === input.reply.threadRef)
      .sort((left, right) => (momentOf(left.sentAt) ?? 0) - (momentOf(right.sentAt) ?? 0));
    if (direct.length > 0) {
      chosen = direct[direct.length - 1];
      attribution = "direct_reply";
      evidence = "thread_metadata";
    }
  }

  /* No explicit tie: the single most recent plausible send. If two sends
     share that moment, the tie cannot be broken honestly, so nothing is. */
  if (!chosen && candidates.length > 0) {
    const ordered = [...candidates].sort(
      (left, right) => (momentOf(left.sentAt) ?? 0) - (momentOf(right.sentAt) ?? 0),
    );
    const newest = ordered[ordered.length - 1]!;
    const rival = ordered[ordered.length - 2];
    if (!rival || momentOf(rival.sentAt) !== momentOf(newest.sentAt)) {
      chosen = newest;
      attribution = "likely_influenced";
      evidence = "recency_heuristic";
    }
  }

  if (!chosen || !attribution) {
    return { relationshipEvent, touchUpdate: null };
  }

  const sentAt = momentOf(chosen.sentAt)!;
  const dimensional = appendOutcomeEvent(chosen.dimensional, {
    kind: "reply_observed",
    observed_at: input.reply.occurredAt,
    channel: input.reply.channel,
    message_ref: input.reply.messageRef,
    attribution,
    evidence: evidence!,
    reply_latency_ms: repliedAt - sentAt,
  });
  return {
    relationshipEvent,
    touchUpdate: dimensional ? { draftId: chosen.draftId, dimensional } : null,
  };
}

/* ------------------------------------------------------ silence planning */

/**
 * The silence reading for one send: "no_response_observed_30d" once the
 * window has passed, null while it is still open. Pure, so the daily
 * pipeline and any on-read surface compute the same answer.
 */
export function silenceObservation(
  sentAt: string,
  now: string,
): "no_response_observed_30d" | null {
  const sent = momentOf(sentAt);
  const current = momentOf(now);
  if (sent === null || current === null) return null;
  return current - sent >= NO_RESPONSE_WINDOW_DAYS * DAY_MS ? "no_response_observed_30d" : null;
}

/**
 * Plan the silence observation for one send's dimensional record. It is an
 * observation, not a verdict: it appends to history and a later reply
 * appends after it. Recorded once per record; recorded never when a reply
 * event already exists, because that history is not silence.
 */
export function planSilenceObservation(
  stored: unknown,
  input: { sentAt: string; now: string; channel: string | null },
): Record<string, unknown> | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  if (!silenceObservation(input.sentAt, input.now)) return null;
  const events = readOutcomeEvents(stored);
  if (events.some((event) => event.kind === "no_response_observed_30d")) return null;
  if (events.some((event) => event.kind === "reply_observed")) return null;
  const waitedMs = (momentOf(input.now) ?? 0) - (momentOf(input.sentAt) ?? 0);
  return appendOutcomeEvent(stored, {
    kind: "no_response_observed_30d",
    observed_at: input.now,
    channel: input.channel,
    message_ref: null,
    reply_latency_ms: waitedMs,
  });
}
