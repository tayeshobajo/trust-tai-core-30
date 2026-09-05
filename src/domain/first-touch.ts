/**
 * Trust Tai OS, first touch.
 *
 * A first touch is the first time a person at Trust Tai actually reached out
 * to a relationship. It is outreach, not activity:
 *
 *   * It must be outbound. Someone writing to us is not us starting something.
 *   * It must be on a channel a person can genuinely reach out on. An internal
 *     note is a record for ourselves, not contact with anyone.
 *   * A person must have put it on the record. Automated ingestion and imports
 *     never create outreach.
 *   * A withdrawn record makes no claim.
 *   * It counts in the week the relationship's *first eligible outbound* touch
 *     happened. Earlier inbound contact does not disqualify it; earlier
 *     outbound contact does, because then the first outreach already happened.
 *
 * The eligible channel list is the extension point: when a new human outbound
 * channel becomes canonical (a voice note, say), it is added here and nowhere
 * else.
 */

import type { ThreadChannel } from "./comms";
import type { ID, ISODateTime } from "./entities";
import type { WeekWindow } from "./revenue";
import { isInWeek } from "./revenue";

/**
 * Channels a person can make first contact on today. `note` is excluded: it is
 * an internal record, not an approach to anyone.
 */
export const FIRST_TOUCH_CHANNELS: ThreadChannel[] = [
  "email",
  "call",
  "meeting",
  "message",
  "linkedin",
  "text",
];

export function isFirstTouchChannel(value: unknown): value is ThreadChannel {
  return typeof value === "string" && (FIRST_TOUCH_CHANNELS as string[]).includes(value);
}

/** A logged touch, reduced to the facts first-touch counting depends on. */
export interface FirstTouchCandidate {
  relationshipId: ID;
  channel: unknown;
  direction: unknown;
  occurredAt: ISODateTime;
  /** Who put it on the record. Absent means it arrived without a person. */
  loggedBy?: ID | null;
  retracted?: boolean;
}

/** Is this touch a real human outreach, of the kind that can be a first touch? */
export function isEligibleFirstTouch(touch: FirstTouchCandidate): boolean {
  if (touch.retracted) return false;
  if (touch.direction !== "outbound") return false;
  if (!isFirstTouchChannel(touch.channel)) return false;
  if (!touch.loggedBy) return false;
  if (!touch.relationshipId) return false;
  return !Number.isNaN(new Date(touch.occurredAt).getTime());
}

/**
 * How many relationships received their very first human outreach in this week.
 *
 * `touches` must contain every eligible touch that could be earlier, not just
 * the ones inside the window, or an old relationship reads as a new one.
 */
export function countFirstTouches(touches: FirstTouchCandidate[], week: WeekWindow): number {
  const earliest = new Map<ID, number>();
  for (const touch of touches) {
    if (!isEligibleFirstTouch(touch)) continue;
    const at = new Date(touch.occurredAt).getTime();
    const known = earliest.get(touch.relationshipId);
    if (known === undefined || at < known) earliest.set(touch.relationshipId, at);
  }
  let count = 0;
  for (const at of earliest.values()) {
    if (isInWeek(new Date(at).toISOString(), week)) count += 1;
  }
  return count;
}
