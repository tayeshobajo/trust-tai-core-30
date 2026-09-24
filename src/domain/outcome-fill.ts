/**
 * Outcome fill: the moment the judgment memory learns what happened.
 *
 * Every dimensional record (src/domain/dimensional-record.ts) is captured
 * with `outcome: null`, an honest "not known yet". This module is the only
 * place that null becomes a fact, and it does so under three laws:
 *
 *  1. DETERMINISTIC ONLY. An inbound message on the relationship fills
 *     `outcome: "replied"` with the latency, channel, and a pointer to the
 *     message. Whether the reply was warm, cold, or a brush-off is semantic
 *     judgment, and semantic judgment is a later phase: it stays null here.
 *  2. SILENCE IS ALSO AN OUTCOME. Thirty days with nothing inbound after a
 *     send fills `outcome: "no_response_30d"`. Computed from timestamps,
 *     never guessed.
 *  3. FILLED ONCE, NEVER REWRITTEN. An outcome already on the record is
 *     immutable; every function here returns null rather than overwrite,
 *     so callers write nothing.
 *
 * Pure and I/O-free. The server module (comms-outcome-fill.server.ts)
 * applies these rules; tests pin them. Outcome fills are observational:
 * they record what happened and never trigger a send.
 */

/** Silence becomes an outcome only after this many days with no reply. */
export const NO_RESPONSE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A parseable moment, or null. Bad timestamps fill nothing. */
function momentOf(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A record whose outcome leg is still open: a real dimensional record,
 * jsonb round trip tolerated, with `outcome` still null. Anything else,
 * no record, or an outcome already filled, is not fillable.
 */
function openRecord(stored: unknown): Record<string, unknown> | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  if (record["outcome"] !== null && record["outcome"] !== undefined) return null;
  return record;
}

export interface RepliedFillInput {
  /** When the draft actually went out (rationale.send.sent_at). */
  sentAt: string;
  /** When the inbound message was observed on the wire. */
  repliedAt: string;
  /** Which channel carried the reply: "email" or "linkedin". */
  channel: string;
  /** Pointer to the inbound row: provider message id or touch id. */
  messageRef: string;
}

/**
 * Fill the outcome leg from an observed inbound reply. Returns the updated
 * record, or null when there is nothing lawful to write: no record, an
 * outcome already filled, unparseable timestamps, or a reply that predates
 * the send (that message answered something else).
 */
export function withRepliedOutcome(
  stored: unknown,
  input: RepliedFillInput,
): Record<string, unknown> | null {
  const record = openRecord(stored);
  if (!record) return null;
  const sentAt = momentOf(input.sentAt);
  const repliedAt = momentOf(input.repliedAt);
  if (sentAt === null || repliedAt === null || repliedAt < sentAt) return null;
  return {
    ...record,
    outcome: "replied",
    outcome_observed_at: input.repliedAt,
    outcome_detail: {
      channel: input.channel,
      message_ref: input.messageRef,
      reply_latency_ms: repliedAt - sentAt,
    },
    /* The judgment layer's slot, named and honestly empty. Whether this
       reply was positive is not a timestamp's call to make. */
    outcome_semantic: null,
  };
}

/**
 * The silence verdict for one send: "no_response_30d" once the window has
 * passed, null while the window is still open. Pure, so the daily pipeline
 * and any on-read surface compute the same answer.
 */
export function silenceOutcome(sentAt: string, now: string): "no_response_30d" | null {
  const sent = momentOf(sentAt);
  const current = momentOf(now);
  if (sent === null || current === null) return null;
  return current - sent >= NO_RESPONSE_WINDOW_DAYS * DAY_MS ? "no_response_30d" : null;
}

export interface SilenceFillInput {
  sentAt: string;
  now: string;
  channel: string | null;
}

/**
 * Fill the outcome leg for a send that got silence. The caller has already
 * verified nothing inbound landed after the send; this function only rules
 * on the window and the record's fillability.
 */
export function withSilenceOutcome(
  stored: unknown,
  input: SilenceFillInput,
): Record<string, unknown> | null {
  const record = openRecord(stored);
  if (!record) return null;
  const verdict = silenceOutcome(input.sentAt, input.now);
  if (!verdict) return null;
  const waitedMs = (momentOf(input.now) ?? 0) - (momentOf(input.sentAt) ?? 0);
  return {
    ...record,
    outcome: verdict,
    outcome_observed_at: input.now,
    outcome_detail: {
      channel: input.channel,
      days_waited: Math.floor(waitedMs / DAY_MS),
    },
    outcome_semantic: null,
  };
}
