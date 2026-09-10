/**
 * Trust Tai OS, the business week.
 *
 * A week is Monday 00:00 in the organization's own timezone through the
 * following Monday 00:00, exclusive. Everything a person reads about "this
 * week" must agree with the calendar on their wall, not with the calendar on
 * whichever machine happens to be running the code.
 *
 * Rules this module holds:
 *
 *   * The timezone is always an explicit IANA name. Server-local time is never
 *     consulted, so the same instant produces the same week everywhere.
 *   * The returned boundaries are UTC instants, because that is what the
 *     database compares against.
 *   * Daylight saving is handled by resolving the wall time twice against the
 *     real offset, so a spring-forward week is 167 hours and a fall-back week
 *     is 169 hours, and both start at local midnight.
 *   * An unusable timezone is never silently swapped for the server's. The
 *     caller either gets a refusal or an explicitly reported fallback.
 */

import type { WeekWindow } from "./revenue";

/**
 * The one documented fallback. Used only when an organization has no usable
 * timezone recorded, and always reported so the reader knows it happened.
 */
export const CANONICAL_FALLBACK_TIME_ZONE = "UTC";

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedTimeZone {
  timeZone: string;
  /** True when the organization's own timezone was missing or unusable. */
  fallback: boolean;
  because?: string;
}

/** Resolve an organization timezone, never reaching for the server's. */
export function resolveBusinessTimeZone(value: unknown): ResolvedTimeZone {
  if (isValidTimeZone(value)) return { timeZone: value, fallback: false };
  return {
    timeZone: CANONICAL_FALLBACK_TIME_ZONE,
    fallback: true,
    because:
      typeof value === "string" && value.trim()
        ? `"${value}" is not a timezone this system recognises, so the week is shown in ${CANONICAL_FALLBACK_TIME_ZONE}.`
        : `This organization has no timezone set, so the week is shown in ${CANONICAL_FALLBACK_TIME_ZONE}.`,
  };
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(instant: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of the zone from UTC at a given instant, in milliseconds, east positive. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClockAt(instant, timeZone);
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - instant
  );
}

/** The UTC instant at which the given local wall date begins in the zone. */
function startOfLocalDay(year: number, month: number, day: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // Two passes: the first offset is read at the wrong instant on a DST day,
  // the second is read at very nearly the right one, which is enough.
  let instant = wall - offsetAt(wall, timeZone);
  instant = wall - offsetAt(instant, timeZone);
  return instant;
}

/**
 * The Monday-start business week, in the organization's timezone, expressed as
 * UTC instants for database comparison.
 */
export function businessWeek(at: Date | string | number, timeZone: string): WeekWindow {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`A business week needs a real timezone, not "${String(timeZone)}".`);
  }
  const instant = typeof at === "number" ? at : new Date(at).getTime();
  if (Number.isNaN(instant)) throw new Error("A business week needs a real date.");

  const wall = wallClockAt(instant, timeZone);
  // Sunday is 0 in getUTCDay, so Sunday belongs to the week that began six days back.
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  const back = (weekday + 6) % 7;

  const monday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day - back));
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day - back + 7));

  const start = startOfLocalDay(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    timeZone,
  );
  const end = startOfLocalDay(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );

  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/* ------------------------------------------------------------ local days */

const LOCAL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A date a person typed ("2026-09-19") is a day in the organization's zone,
 * not a UTC midnight. This returns the UTC instant that local day begins, so
 * the same value can be stored once and read back as the same day.
 */
export function localDayStart(day: string, timeZone: string): string | null {
  const match = LOCAL_DAY.exec(day.trim());
  if (!match || !isValidTimeZone(timeZone)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  const instant = startOfLocalDay(year, month, date, timeZone);
  const check = wallClockAt(instant, timeZone);
  // Reject days that do not exist (Feb 30) rather than letting them roll over.
  if (check.year !== year || check.month !== month || check.day !== date) return null;
  return new Date(instant).toISOString();
}

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** The wall date of an instant in the organization's zone. */
export function localDateOf(at: Date | string | number, timeZone: string): LocalDate | null {
  if (!isValidTimeZone(timeZone)) return null;
  const instant = typeof at === "number" ? at : new Date(at).getTime();
  if (Number.isNaN(instant)) return null;
  const wall = wallClockAt(instant, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

/**
 * Whole local days from one instant to another, by calendar date in the zone,
 * so "renews in 16 days" means sixteen sleeps for the people in that zone and
 * never shifts by one across a DST change.
 */
export function localDaysBetween(
  from: Date | string | number,
  to: Date | string | number,
  timeZone: string,
): number | null {
  const a = localDateOf(from, timeZone);
  const b = localDateOf(to, timeZone);
  if (!a || !b) return null;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}
