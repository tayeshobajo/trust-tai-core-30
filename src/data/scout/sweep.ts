/**
 * The bounded watchlist sweep, pure logic.
 *
 * Sentinel is curated only, so a sweep never looks further than the companies
 * a person put on the watchlist. It re-reads what is missing or stale, leaves
 * everything fresh alone, and stops at a fixed number per run.
 *
 * Nothing here calls a network, writes state, or decides that something moved.
 * Movement is a separate law: this module prepares truth, it never interprets
 * it.
 */

import type { ProspectCandidate } from "@/domain/scout";
import { lastResearchedAt } from "./research-brief";
import { researchPermission } from "./research-consent";
import { RESEARCH_STALE_DAYS } from "./research-run";

/** How many companies one run may read. Bounded, always. */
export const SWEEP_PER_RUN_CAP = 10;

/** Beyond this the surface asks a person to trim, it never truncates quietly. */
export const SWEEP_WATCHLIST_SOFT_CAP = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SweepCadence = "daily" | "weekly";

export interface SweepSettings {
  /** Automatic checking on or off. A person can always run one by hand. */
  enabled: boolean;
  cadence: SweepCadence;
}

export const DEFAULT_SWEEP_SETTINGS: SweepSettings = { enabled: true, cadence: "daily" };

export const SWEEP_CADENCE_LABEL: Record<SweepCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
};

/** The one sentence describing the bound, shown wherever the setting lives. */
export const SWEEP_BOUND_NOTE = `Scout re-reads up to ${SWEEP_PER_RUN_CAP} watched companies a run, oldest first, and only when their evidence is missing or older than ${RESEARCH_STALE_DAYS} days.`;

/**
 * The minimum a sweep needs to know about a company. Both the browser (from a
 * candidate) and the server (from a stored row) reduce to this shape, so one
 * planner governs both.
 */
export interface SweepCandidate {
  prospectId: string;
  name: string;
  websiteUrl: string | null;
  /** When public pages were last actually read, or null when never. */
  lastResearchedAt: string | null;
  canResearch: boolean;
  /** Why research is not permitted. Only read when `canResearch` is false. */
  permissionBecause: string;
  /** Workflow status, so a passed or archived company is left alone. */
  status: string;
}

export type SweepReason = "never_checked" | "outdated";

export interface SweepTarget extends SweepCandidate {
  reason: SweepReason;
}

export interface SweepSkip {
  prospectId: string;
  name: string;
  because: string;
}

export interface SweepPlan {
  watchedCount: number;
  /** What this run will read, oldest first, never more than the cap. */
  due: SweepTarget[];
  /** Due but over the per-run cap. They wait for the next run. */
  deferred: number;
  /** Checked recently enough that reading again would tell us nothing new. */
  alreadyCurrent: number;
  skipped: SweepSkip[];
  /** True when the watchlist is longer than one run can honestly cover. */
  overSoftCap: boolean;
  summary: string;
}

function ageDays(at: string | null, now: number): number | null {
  if (!at) return null;
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : (now - time) / DAY_MS;
}

/** Reduce a board candidate to what the sweep needs. Watched rows only. */
export function sweepCandidate(candidate: ProspectCandidate): SweepCandidate {
  const permission = researchPermission(candidate);
  return {
    prospectId: candidate.prospect.id,
    name: candidate.prospect.name,
    websiteUrl: candidate.prospect.websiteUrl || candidate.prospect.domain || null,
    lastResearchedAt: lastResearchedAt(candidate),
    canResearch: permission.canResearch,
    permissionBecause: permission.because,
    status: candidate.prospect.status,
  };
}

/** Only companies a person put on the watchlist, in candidate form. */
export function watchedCandidates(candidates: ProspectCandidate[]): ProspectCandidate[] {
  return candidates.filter((candidate) => Boolean(candidate.watchlist));
}

/**
 * Decide what one run should read. Bounded on every axis: curated scope,
 * staleness, a per-run cap, and research permission.
 */
export function planSweep(input: {
  candidates: SweepCandidate[];
  now?: string;
  /** Read even companies whose evidence is still fresh. */
  force?: boolean;
}): SweepPlan {
  const now = Date.parse(input.now ?? new Date().toISOString());
  const watched = input.candidates.filter(
    (candidate) => candidate.status !== "passed" && candidate.status !== "archived",
  );

  const skipped: SweepSkip[] = [];
  const due: SweepTarget[] = [];
  let alreadyCurrent = 0;

  for (const candidate of watched) {
    if (!candidate.canResearch) {
      skipped.push({
        prospectId: candidate.prospectId,
        name: candidate.name,
        because: candidate.permissionBecause,
      });
      continue;
    }
    if (!candidate.websiteUrl) {
      skipped.push({
        prospectId: candidate.prospectId,
        name: candidate.name,
        because: "No website is on file, so there is nothing public to read.",
      });
      continue;
    }
    const age = ageDays(candidate.lastResearchedAt, now);
    if (age === null) {
      due.push({ ...candidate, reason: "never_checked" });
      continue;
    }
    if (input.force || age >= RESEARCH_STALE_DAYS) {
      due.push({ ...candidate, reason: "outdated" });
      continue;
    }
    alreadyCurrent += 1;
  }

  // Oldest first, never-checked before merely stale.
  due.sort((a, b) => {
    if (!a.lastResearchedAt && !b.lastResearchedAt) return 0;
    if (!a.lastResearchedAt) return -1;
    if (!b.lastResearchedAt) return 1;
    return a.lastResearchedAt.localeCompare(b.lastResearchedAt);
  });

  const capped = due.slice(0, SWEEP_PER_RUN_CAP);
  const deferred = due.length - capped.length;
  const overSoftCap = watched.length > SWEEP_WATCHLIST_SOFT_CAP;

  return {
    watchedCount: watched.length,
    due: capped,
    deferred,
    alreadyCurrent,
    skipped,
    overSoftCap,
    summary:
      capped.length === 0
        ? watched.length === 0
          ? "Nothing is being watched, so there is nothing to check."
          : `Everything on the watchlist was checked in the last ${RESEARCH_STALE_DAYS} days.`
        : `${capped.length} to read${deferred > 0 ? `, ${deferred} waiting for the next run` : ""}.`,
  };
}

/* ------------------------------------------------------------- outcomes --- */

export interface SweepOutcome {
  prospectId: string;
  name: string;
  state: "read" | "unreadable";
  /** True only when the pass actually added or replaced an observation. */
  changed: boolean;
  because?: string;
}

export interface SweepSummary {
  watched: number;
  read: number;
  changed: number;
  alreadyCurrent: number;
  unreadable: number;
  skipped: number;
  deferred: number;
  /** Counts only. Never a percentage, never a health score. */
  countsLine: string;
  /** The quiet sentence. Says nothing happened when nothing happened. */
  quietLine: string;
}

export function summarizeSweep(input: { plan: SweepPlan; outcomes: SweepOutcome[] }): SweepSummary {
  const read = input.outcomes.filter((outcome) => outcome.state === "read");
  const unreadable = input.outcomes.filter((outcome) => outcome.state === "unreadable");
  const changed = read.filter((outcome) => outcome.changed).length;

  const counts = [
    `${input.plan.watchedCount} watched`,
    `${read.length} read`,
    `${input.plan.alreadyCurrent} already current`,
    `${unreadable.length} could not be read`,
  ];
  if (input.plan.skipped.length > 0) counts.push(`${input.plan.skipped.length} skipped`);
  if (input.plan.deferred > 0) counts.push(`${input.plan.deferred} waiting`);

  let quietLine: string;
  if (read.length === 0 && unreadable.length === 0) {
    quietLine =
      input.plan.watchedCount === 0
        ? "Nothing is being watched yet."
        : `Everything on the watchlist was checked in the last ${RESEARCH_STALE_DAYS} days.`;
  } else if (changed === 0) {
    quietLine = "Checked. Nothing changed.";
  } else {
    quietLine = `Checked. ${changed} ${changed === 1 ? "company" : "companies"} had new evidence.`;
  }

  return {
    watched: input.plan.watchedCount,
    read: read.length,
    changed,
    alreadyCurrent: input.plan.alreadyCurrent,
    unreadable: unreadable.length,
    skipped: input.plan.skipped.length,
    deferred: input.plan.deferred,
    countsLine: counts.join(" · "),
    quietLine,
  };
}
