/**
 * Trust Tai OS, discovery counting.
 *
 * A discovery call counts only when a person said it was one and it has
 * actually happened. Never inferred from a title, a calendar entry, Fathom or
 * a transcript, and a meeting still in the future is a plan, not an actual.
 *
 * `roadmap_review` is a different thing entirely: it satisfies review cadence
 * and `next_review_at`, and never counts as discovery.
 */

import type { MeetingKind } from "./commercial";
import type { ISODateTime } from "./entities";
import type { WeekWindow } from "./revenue";
import { isInWeek } from "./revenue";

/** A logged touch, reduced to the facts counting depends on. */
export interface CountableTouch {
  meetingKind: MeetingKind | null;
  occurredAt: ISODateTime;
  /** A withdrawn record keeps its history but stops making its claim. */
  retracted?: boolean;
}

function happened(touch: CountableTouch, now: Date): boolean {
  if (touch.retracted) return false;
  const at = new Date(touch.occurredAt).getTime();
  if (Number.isNaN(at)) return false;
  return at <= now.getTime();
}

function countKind(
  touches: CountableTouch[],
  kind: MeetingKind,
  now: Date,
  week?: WeekWindow,
): number {
  return touches.filter(
    (touch) =>
      touch.meetingKind === kind &&
      happened(touch, now) &&
      (week ? isInWeek(touch.occurredAt, week) : true),
  ).length;
}

/** Discovery calls that have already happened. Scheduled meetings do not count. */
export function countDiscoveryCalls(
  touches: CountableTouch[],
  options: { now: Date | string; week?: WeekWindow },
): number {
  const now = typeof options.now === "string" ? new Date(options.now) : options.now;
  return countKind(touches, "discovery", now, options.week);
}

/** Roadmap reviews that have already happened. Distinct from discovery. */
export function countRoadmapReviews(
  touches: CountableTouch[],
  options: { now: Date | string; week?: WeekWindow },
): number {
  const now = typeof options.now === "string" ? new Date(options.now) : options.now;
  return countKind(touches, "roadmap_review", now, options.week);
}
