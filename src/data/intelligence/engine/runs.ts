/**
 * Stage zero: when to run.
 *
 * The engine is not a stream and not a cron job pretending to be one. It runs
 * when the suite has actually changed, and once a day even when it has not, so
 * a read is never older than the working day it is being used in.
 *
 * Everything here is pure: a fingerprint of what the suite currently holds, and
 * a decision about whether that is worth reading again. No timers, no network,
 * no storage, the surface owns those.
 */

import type { SuiteSnapshot } from "../derive";

const DAY = 86_400_000;

/** A read older than this is refreshed even when nothing moved. */
export const DAILY_CADENCE_MS = DAY;

/** How often a surface may check whether the suite moved. Two minutes. */
export const ACTIVITY_POLL_MS = 120_000;

export type RunReason =
  /** Nothing has been read yet in this workspace. */
  | "first_run"
  /** Something was recorded in a room since the last read. */
  | "new_activity"
  /** The last read is from another day. */
  | "daily_cadence"
  /** A person asked for it. */
  | "requested"
  /** Nothing moved and the read is current. */
  | "up_to_date";

export const RUN_REASON_LABEL: Record<RunReason, string> = {
  first_run: "First read of this workspace",
  new_activity: "New activity arrived",
  daily_cadence: "Daily read",
  requested: "You asked for a fresh read",
  up_to_date: "Nothing has moved since the last read",
};

function newest(values: (string | undefined)[]): string {
  const dated = values.filter((value): value is string => Boolean(value)).sort();
  return dated.at(-1) ?? "";
}

/**
 * A short, stable string that changes exactly when the suite's evidence does.
 *
 * Counts plus the newest timestamp per room. It is deliberately cheap and
 * deliberately blunt: it answers "is there anything new to read?", never "what
 * changed?", that question is answered by re-reading, honestly.
 */
export function snapshotFingerprint(snapshot: SuiteSnapshot): string {
  const parts = [
    `scout:${snapshot.candidates.length}:${newest(
      snapshot.candidates.map((c) => c.prospect.updatedAt ?? c.prospect.createdAt),
    )}`,
    `comms:${snapshot.relationships.length}:${newest(
      snapshot.relationships.map((r) => r.lastTouchAt ?? r.updatedAt),
    )}`,
    `roadmap:${snapshot.roadmaps.length}:${snapshot.openDecisions.length}:${newest(
      snapshot.roadmaps.map((r) => r.updatedAt),
    )}`,
    `projects:${snapshot.projects.length}:${newest(
      snapshot.projects.map((p) => p.lastMovedAt ?? p.updatedAt),
    )}`,
    `activity:${snapshot.events.length + snapshot.opsActivities.length}:${newest([
      ...snapshot.events.map((e) => e.occurredAt),
      ...snapshot.opsActivities.map((e) => e.occurredAt),
    ])}`,
    `steward:${snapshot.steward.commitments.length}:${snapshot.steward.conversations.length}:${newest(
      snapshot.steward.commitments.map((c) => c.updatedAt),
    )}`,
    `memory:${snapshot.memory.length}:${newest(snapshot.memory.map((b) => b.recordedAt))}`,
    `withheld:${snapshot.withheld
      .map((w) => w.appId)
      .sort()
      .join("+")}`,
  ];
  return parts.join("|");
}

/** What a surface remembers between runs. Small enough to keep anywhere. */
export interface RunState {
  fingerprint: string;
  at: string;
}

export interface RunDecision {
  run: boolean;
  reason: RunReason;
}

/**
 * Should the engine read again?
 *
 * New evidence wins over cadence, cadence wins over silence, and a person
 * asking wins over everything. When nothing qualifies the answer is no, and
 * the surface keeps the read it already has rather than flickering.
 */
export function shouldRun(input: {
  last?: RunState | null;
  fingerprint: string;
  now: string;
  requested?: boolean;
  cadenceMs?: number;
}): RunDecision {
  if (input.requested) return { run: true, reason: "requested" };
  if (!input.last) return { run: true, reason: "first_run" };
  if (input.last.fingerprint !== input.fingerprint) {
    return { run: true, reason: "new_activity" };
  }
  const since = new Date(input.now).getTime() - new Date(input.last.at).getTime();
  if (!Number.isNaN(since) && since >= (input.cadenceMs ?? DAILY_CADENCE_MS)) {
    return { run: true, reason: "daily_cadence" };
  }
  return { run: false, reason: "up_to_date" };
}

/** How a run is described to a person, with the time it happened. */
export function runSentence(reason: RunReason, at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return RUN_REASON_LABEL[reason];
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${RUN_REASON_LABEL[reason]} · read at ${time}`;
}
