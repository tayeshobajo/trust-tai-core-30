/**
 * What the Comms dashboard puts in front of a person, as pure logic.
 *
 * Three rules hold here:
 *  1. A dated thing that has passed is actionable whatever kind it is — a
 *     follow-up someone scheduled counts exactly as much as a promise.
 *  2. A meeting whose date has passed is not evidence that it never happened.
 *     It is listed as needing a record, not as a failure.
 *  3. A count is the count of the real thing. When a list is cut short for
 *     reading, the page says how many it is showing out of how many there are.
 */

import type { PlanItem } from "./comms-plan";

export interface Bucket {
  items: PlanItem[];
  /** Everything that qualifies, before any slice for display. */
  total: number;
}

function bucket(items: PlanItem[]): Bucket {
  return { items, total: items.length };
}

function due(item: PlanItem): number {
  return item.dueAt ? new Date(item.dueAt).getTime() : Number.POSITIVE_INFINITY;
}

function isPast(value: string | null, now: Date): boolean {
  if (!value) return false;
  const at = new Date(value).getTime();
  return !Number.isNaN(at) && at < now.getTime();
}

/** Recomputed against the clock passed in, never against a stale memo. */
export function overdueAt(item: PlanItem, now: Date): boolean {
  return isPast(item.dueAt, now);
}

export interface WorkBoard {
  repliesOwed: Bucket;
  /** Anything dated that has passed, including follow-ups. Soonest first. */
  pastDue: Bucket;
  /** Meetings whose date has passed and that have no outcome recorded. */
  meetingsNeedingRecord: Bucket;
  upcoming: Bucket;
}

export function buildWorkBoard(items: PlanItem[], now: Date): WorkBoard {
  const past = items.filter((item) => overdueAt(item, now));
  return {
    repliesOwed: bucket(items.filter((item) => item.kind === "reply_due")),
    pastDue: bucket(
      past.filter((item) => item.kind !== "meeting" && item.kind !== "reply_due").sort(
        (a, b) => due(a) - due(b),
      ),
    ),
    meetingsNeedingRecord: bucket(past.filter((item) => item.kind === "meeting")),
    upcoming: bucket(
      items
        .filter((item) => item.dueAt && !overdueAt(item, now) && item.kind !== "reply_due")
        .sort((a, b) => due(a) - due(b)),
    ),
  };
}

/** "Showing 10 of 24" — or nothing at all when the list is complete. */
export function showingNote(shown: number, total: number): string | null {
  return shown < total ? `Showing ${shown} of ${total}.` : null;
}
