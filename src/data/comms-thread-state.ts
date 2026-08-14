/**
 * What a message stream means, as a pure function.
 *
 * No vendor, no network, no database: given messages already normalized into
 * Trust Tai's shape, this says who owes whom, when a reply becomes late, and
 * which person the thread is actually with.
 *
 * It is deliberately separate from any provider so it can be proved correct
 * from fixtures before a single credential exists.
 */

import type { ISODateTime } from "@/domain/entities";
import type { ThreadState } from "@/domain/comms";
import type { NormalizedMessage, ThreadRead } from "@/domain/comms-integrations";

/** A reply we owe is late after this long. One working day, not a cadence. */
export const RESPONSE_WINDOW_HOURS = 24;

const HOUR = 3_600_000;

function time(value: ISODateTime | undefined): number {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Messages in time order, one per provider message id.
 *
 * Applying the same batch twice must change nothing: idempotency starts here,
 * before anything is written.
 */
export function mergeMessages(
  existing: NormalizedMessage[],
  incoming: NormalizedMessage[],
): NormalizedMessage[] {
  const byId = new Map<string, NormalizedMessage>();
  for (const message of [...existing, ...incoming]) {
    if (!message.providerMessageId) continue;
    byId.set(message.providerMessageId, message);
  }
  return [...byId.values()].sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
}

/** How many of these messages are not already on record. */
export function newMessageCount(
  existing: NormalizedMessage[],
  incoming: NormalizedMessage[],
): number {
  const known = new Set(existing.map((message) => message.providerMessageId));
  const seen = new Set<string>();
  let count = 0;
  for (const message of incoming) {
    if (!message.providerMessageId) continue;
    if (known.has(message.providerMessageId) || seen.has(message.providerMessageId)) continue;
    seen.add(message.providerMessageId);
    count += 1;
  }
  return count;
}

/**
 * The one derived reading of a thread.
 *
 * Inbound last means we owe a reply and the clock starts from their message.
 * Outbound last means the ball is with them; silence there is not our debt.
 * A closed thread was closed by a person, so it is passed in, never guessed.
 */
export function readThread(
  messages: NormalizedMessage[],
  options: { closed?: boolean; scheduled?: boolean; responseWindowHours?: number } = {},
): ThreadRead {
  const ordered = mergeMessages([], messages);
  const last = ordered[ordered.length - 1];
  const lastInbound = [...ordered].reverse().find((message) => message.direction === "inbound");
  const lastOutbound = [...ordered].reverse().find((message) => message.direction === "outbound");

  const base: ThreadRead = {
    state: "open",
    messageCount: ordered.length,
    ...(last ? { lastMessageAt: last.occurredAt } : {}),
    ...(lastInbound ? { lastInboundAt: lastInbound.occurredAt } : {}),
    ...(lastOutbound ? { lastOutboundAt: lastOutbound.occurredAt } : {}),
  };

  if (options.closed) return { ...base, state: "closed" };
  if (options.scheduled) return { ...base, state: "scheduled" };
  if (!last) return base;

  if (last.direction === "inbound") {
    const window = (options.responseWindowHours ?? RESPONSE_WINDOW_HOURS) * HOUR;
    const due = time(last.occurredAt) + window;
    const state: ThreadState = "waiting_on_us";
    return {
      ...base,
      state,
      ...(Number.isNaN(due) ? {} : { responseDueAt: new Date(due).toISOString() }),
    };
  }

  return { ...base, state: "waiting_on_them" };
}

/**
 * Who the thread is with.
 *
 * Our own addresses are excluded, so a thread we started reads as being with
 * the person we wrote to rather than with ourselves. Never a name guess: only
 * addresses, lowercased, in first-seen order.
 */
export function counterpartEmails(
  messages: NormalizedMessage[],
  ownAddresses: string[],
): string[] {
  const own = new Set(ownAddresses.map(normalizeEmail).filter(Boolean));
  const seen: string[] = [];
  for (const message of mergeMessages([], messages)) {
    const candidates = [message.fromEmail, ...message.toEmails, ...message.ccEmails];
    for (const candidate of candidates) {
      const email = normalizeEmail(candidate);
      if (!email || own.has(email) || seen.includes(email)) continue;
      seen.push(email);
    }
  }
  return seen;
}

/**
 * The address a relationship should be matched on: the person who wrote to us,
 * or failing that the first person we wrote to. An ambiguous thread returns
 * nothing rather than picking one, so a human resolves it.
 */
export function primaryCounterpart(
  messages: NormalizedMessage[],
  ownAddresses: string[],
): string | undefined {
  const own = new Set(ownAddresses.map(normalizeEmail).filter(Boolean));
  const inbound = mergeMessages([], messages).find(
    (message) => message.direction === "inbound" && !own.has(normalizeEmail(message.fromEmail)),
  );
  const fromInbound = normalizeEmail(inbound?.fromEmail);
  if (fromInbound) return fromInbound;
  return counterpartEmails(messages, ownAddresses)[0];
}

/**
 * The touch summary a synced message becomes.
 *
 * `last_touch_at` may only move for something that actually happened, so this
 * is derived from the message itself and nothing else.
 */
export function touchSummary(message: NormalizedMessage): string {
  const subject = message.subject?.trim();
  const who = message.fromName?.trim() || message.fromEmail?.trim();
  if (message.direction === "inbound") {
    return subject ? `They wrote: ${subject}` : `${who ?? "They"} wrote`;
  }
  return subject ? `We wrote: ${subject}` : "We wrote";
}
