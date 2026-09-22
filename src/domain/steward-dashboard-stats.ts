/**
 * Trust Tai OS, Steward per-person dashboard stats.
 *
 * Every number a person sees on their dashboard is computed here, as a pure
 * function over rows that already exist: the shared public.activities stream
 * and the Steward task checklist. Nothing is stored, nothing is a counter, and
 * nothing is invented. When there are no rows the honest answer is zero: streak
 * 0, XP 0, Level 1, time saved 0, tasks 0 of 0.
 *
 * The data model decision (Phase 4): the activities stream is the ledger. XP,
 * streak and time saved are aggregations over a person's own activity rows; the
 * completed-tasks count reads the Steward task checklist directly. No new table.
 */

import type { StewardTask } from "./steward-accountability";

/* --------------------------------------------------------------------- XP */

/**
 * How much a recorded event is worth, keyed by the activities `event_type`
 * (which the writer fills from the event name, e.g. "steward.task.completed").
 *
 * Kept deliberately small and legible. An event_type not listed here is worth
 * nothing, so an unfamiliar or accidental row can never inflate a score. The
 * weights reward finishing work and confirming a direction over mere edits.
 */
export const XP_WEIGHTS: Record<string, number> = {
  "task.completed": 50,
  "proposal.confirmed": 40,
  /* An agent clear is written as task.status_changed with an agent_cleared
     payload flag (ActivityName has no dedicated "cleared" action); the read
     side folds that into this same weight via actorIsAgent, not this map. */
  "task.status_changed": 30,
  "task.assigned": 10,
  "task.updated": 5,
};

/** The XP weight for one event_type. Unknown types are worth nothing. */
export function xpForEvent(eventType: string): number {
  return XP_WEIGHTS[eventType] ?? 0;
}

/** Sum of XP across a person's own events. Unknown event types contribute 0. */
export function computeXp(events: { eventType: string }[]): number {
  let total = 0;
  for (const event of events) total += xpForEvent(event.eventType);
  return total;
}

/* ------------------------------------------------------------------ level */

export interface LevelInfo {
  /** 1 or above. An empty history is Level 1, never Level 0. */
  level: number;
  /** A human tier name for this level. */
  label: string;
  /** XP earned since this level began. */
  xpIntoLevel: number;
  /** XP needed to move from this level to the next. */
  xpForLevel: number;
}

/** XP required to have reached the start of a given level. Level 1 starts at 0. */
function xpAtLevelStart(level: number): number {
  if (level <= 1) return 0;
  /* Inverse of the level curve below: level = floor(sqrt(xp / 50)) + 1, so a
     level L begins at xp = 50 * (L - 1)^2. Pure, no stored state. */
  const steps = level - 1;
  return 50 * steps * steps;
}

/** Tier names by level band. Levels beyond the last band keep the last name. */
const LEVEL_LABELS = [
  "Getting started",
  "Contributor",
  "Operator",
  "Driver",
  "Captain",
] as const;

function labelForLevel(level: number): string {
  const index = Math.min(level - 1, LEVEL_LABELS.length - 1);
  return LEVEL_LABELS[Math.max(0, index)] ?? LEVEL_LABELS[0];
}

/**
 * The level for a total XP, plus how far into the level a person is. Pure.
 *
 * Curve: level = floor(sqrt(xp / 50)) + 1. Negative or non-finite XP is treated
 * as zero, so a bad input is honest zero rather than a crash.
 */
export function levelForXp(xp: number): LevelInfo {
  const safe = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = Math.floor(Math.sqrt(safe / 50)) + 1;
  const start = xpAtLevelStart(level);
  const nextStart = xpAtLevelStart(level + 1);
  return {
    level,
    label: labelForLevel(level),
    xpIntoLevel: safe - start,
    xpForLevel: nextStart - start,
  };
}

/* ----------------------------------------------------------------- streak */

/** The UTC calendar day (YYYY-MM-DD) an ISO instant falls on, or null. */
function utcDayOf(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The UTC day that is `back` days before the given YYYY-MM-DD day. */
function shiftUtcDay(day: string, back: number): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(ms - back * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Current streak in days: distinct UTC calendar days with at least one activity
 * by this person, counted backward from today while consecutive. Pure.
 *
 * v1 uses the UTC date for each instant (documented tradeoff: a late-night
 * action can land on the next UTC day). Today itself does not need an activity
 * for the streak to run; a gap of one full day ends it. Empty input is 0.
 */
export function computeStreakDays(occurredAtISO: string[], todayISO: string): number {
  const today = utcDayOf(todayISO);
  if (!today) return 0;

  const days = new Set<string>();
  for (const iso of occurredAtISO) {
    const day = utcDayOf(iso);
    if (day) days.add(day);
  }
  if (days.size === 0) return 0;

  /* Walk back from today. If today has no activity, the streak may still start
     yesterday; but once a day with no activity is reached, it stops. */
  let streak = 0;
  let cursor = today;
  /* Allow the run to begin at today or the most recent prior active day. */
  if (!days.has(cursor)) {
    const yesterday = shiftUtcDay(today, 1);
    if (!days.has(yesterday)) return 0;
    cursor = yesterday;
  }
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftUtcDay(cursor, 1);
  }
  return streak;
}

/* ------------------------------------------------------------ time saved */

/**
 * Minutes an AI teammate saved this person, summed from real estimates only.
 *
 * A row counts only when it was an agent action (actorIsAgent) and it carries a
 * finite, positive minutesSaved. Older rows without an estimate contribute 0,
 * so the total is honest rather than back-filled. Pure.
 */
export function computeMinutesSaved(
  events: { actorIsAgent: boolean; minutesSaved?: number }[],
): number {
  let total = 0;
  for (const event of events) {
    if (!event.actorIsAgent) continue;
    const minutes = event.minutesSaved;
    if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
      total += minutes;
    }
  }
  return total;
}

/* ------------------------------------------------------- tasks completed */

export interface TasksCompleted {
  done: number;
  total: number;
}

/**
 * Completed vs total tasks for a person. Pure.
 *
 * When ownerUserId is given, only tasks owned by that person's user id count,
 * so a team view reports that person's real numbers and never everyone's. When
 * it is omitted, every task in the list is counted. done is state 'complete'.
 */
export function computeTasksCompleted(
  tasks: StewardTask[],
  ownerUserId?: string,
): TasksCompleted {
  const scoped = ownerUserId
    ? tasks.filter((task) => task.owner.userId === ownerUserId)
    : tasks;
  const done = scoped.filter((task) => task.state === "complete").length;
  return { done, total: scoped.length };
}
