/**
 * Controlled research runs, pure logic.
 *
 * A re-run is not a reset. It updates the evidence that is missing or has gone
 * stale, and leaves everything else exactly as it was:
 *
 *   - the founder's stated testimony is never touched, only Website owns it;
 *   - the research consent decision is never re-asked or overwritten;
 *   - prior observations survive a pass that did not reach them again.
 *
 * Nothing here calls a network, writes state, or triggers another room. It
 * plans, it merges, and it reports the lifecycle state.
 */

import type { ScoutSignal } from "@/domain/scout";
import type { ResearchPermission } from "./research-consent";
import {
  COVERAGE_AREA_LABEL,
  areaForText,
  researchState,
  type CoverageArea,
  type ResearchState,
} from "./research-brief";

/** Evidence older than this is re-read on a controlled re-run. */
export const RESEARCH_STALE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RerunReason = "never_checked" | "outdated";

export interface RerunTarget {
  key: string;
  label: string;
  reason: RerunReason;
  /** When this area was last read, or null when it never was. */
  lastCheckedAt: string | null;
}

export type ResearchRunMode = "initial" | "targeted" | "up_to_date" | "blocked";

export interface ResearchRunPlan {
  mode: ResearchRunMode;
  /** True only when a run may actually happen right now. */
  allowed: boolean;
  blockedBecause: string | null;
  /** The areas this run is meant to fill in or refresh. */
  targets: RerunTarget[];
  /** Area labels whose existing evidence is kept untouched. */
  preservedAreas: string[];
  /** Things this run will not change, stated plainly for the operator. */
  preserves: string[];
  summary: string;
}

function ageDays(at: string | null, now: number): number | null {
  if (!at) return null;
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : (now - time) / DAY_MS;
}

function checkedAt(area: CoverageArea, fallback: string | null): string | null {
  return area.evidence?.provenance.observedAt ?? fallback;
}

/**
 * Decide what a run should do. Permission is honoured exactly as given: a
 * withheld or unresolved decision blocks the run and says why.
 */
export function planResearchRun(input: {
  coverage: { areas: CoverageArea[] };
  permission: Pick<ResearchPermission, "state" | "because" | "canResearch">;
  lastResearchedAt: string | null;
  /** Refresh everything, even areas that are still fresh. */
  force?: boolean;
  now?: string;
}): ResearchRunPlan {
  const now = Date.parse(input.now ?? new Date().toISOString());
  const preserves = [
    "What the founder told us stays exactly as they said it.",
    "The research permission decision on file is not re-asked or changed.",
    "Evidence outside this run's targets is kept, not overwritten.",
  ];

  const targets: RerunTarget[] = [];
  const preservedAreas: string[] = [];
  for (const area of input.coverage.areas) {
    const at = checkedAt(area, input.lastResearchedAt);
    if (!area.checked) {
      targets.push({
        key: area.key,
        label: area.label,
        reason: "never_checked",
        lastCheckedAt: null,
      });
      continue;
    }
    const age = ageDays(at, now);
    if (input.force || age === null || age >= RESEARCH_STALE_DAYS) {
      targets.push({ key: area.key, label: area.label, reason: "outdated", lastCheckedAt: at });
    } else {
      preservedAreas.push(area.label);
    }
  }

  if (!input.permission.canResearch) {
    return {
      mode: "blocked",
      allowed: false,
      blockedBecause: input.permission.because,
      targets,
      preservedAreas,
      preserves,
      summary:
        input.permission.state === "withheld"
          ? "They declined public research. Nothing will run."
          : "Research permission is unresolved, so nothing runs until a person decides.",
    };
  }

  if (targets.length === 0) {
    return {
      mode: "up_to_date",
      allowed: false,
      blockedBecause: `Every area was checked within the last ${RESEARCH_STALE_DAYS} days.`,
      targets,
      preservedAreas,
      preserves,
      summary: "Nothing is missing or stale. Force a refresh only if you have a reason.",
    };
  }

  const initial = preservedAreas.length === 0 && !input.lastResearchedAt;
  const missing = targets.filter((target) => target.reason === "never_checked").length;
  const stale = targets.length - missing;
  return {
    mode: initial ? "initial" : "targeted",
    allowed: true,
    blockedBecause: null,
    targets,
    preservedAreas,
    preserves,
    summary: initial
      ? `First pass: ${targets.length} area${targets.length === 1 ? "" : "s"} to read.`
      : `${missing} never checked, ${stale} older than ${RESEARCH_STALE_DAYS} days. ${preservedAreas.length} kept as-is.`,
  };
}

/* ------------------------------------------------------------- merging --- */

type Row = Record<string, unknown>;

function rowKey(row: Row, index: number): string {
  const value = row["key"] ?? row["id"] ?? row["label"];
  return typeof value === "string" && value.trim() ? value.trim() : `row_${index}`;
}

function rowText(row: Row): string {
  return [row["label"], row["key"], row["statement"], row["evidence"], row["source_url"]]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

/**
 * Merge a new pass over the evidence already held. New observations win for
 * the same key; anything the pass did not reach is preserved rather than
 * silently deleted, so a re-run can never make a company look less researched.
 */
export function mergeObservedRows(input: {
  previous: unknown[];
  incoming: unknown[];
  /** Area keys this run set out to refresh. Reported, never used to delete. */
  targetKeys?: string[];
}): { merged: Row[]; kept: number; replaced: number; added: number } {
  const incoming = input.incoming.map((item) => (item ?? {}) as Row);
  const previous = input.previous.map((item) => (item ?? {}) as Row);
  const incomingKeys = new Set(incoming.map(rowKey));

  let replaced = 0;
  const kept: Row[] = [];
  for (const [index, row] of previous.entries()) {
    if (incomingKeys.has(rowKey(row, index))) {
      replaced += 1;
      continue;
    }
    kept.push(row);
  }

  return {
    merged: [...incoming, ...kept],
    kept: kept.length,
    replaced,
    added: incoming.length - replaced,
  };
}

/** Which coverage areas a set of observation rows actually speaks to. */
export function areasCovered(rows: unknown[]): string[] {
  const keys = new Set<string>();
  for (const item of rows) {
    const key = areaForText(rowText((item ?? {}) as Row));
    if (key) keys.add(key);
  }
  return [...keys].map((key) => COVERAGE_AREA_LABEL[key] ?? key);
}

/* ----------------------------------------------------------- lifecycle --- */

export interface ResearchLifecycle {
  state: ResearchState;
  /** True when the Run research button may be pressed. */
  canRun: boolean;
  /** Why it cannot, in plain language. Null when it can. */
  blockedBecause: string | null;
  plan: ResearchRunPlan;
}

export function researchLifecycle(input: {
  coverage: { areas: CoverageArea[]; checkedCount: number };
  permission: Pick<ResearchPermission, "state" | "because" | "canResearch">;
  observedCount: number;
  contradictions: number;
  lastResearchedAt: string | null;
  running?: boolean;
  force?: boolean;
  now?: string;
}): ResearchLifecycle {
  const plan = planResearchRun({
    coverage: input.coverage,
    permission: input.permission,
    lastResearchedAt: input.lastResearchedAt,
    ...(input.force === undefined ? {} : { force: input.force }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const state = researchState({
    observedCount: input.observedCount,
    canResearch: input.permission.canResearch,
    contradictions: input.contradictions,
    checkedCount: input.coverage.checkedCount,
    ...(input.running === undefined ? {} : { running: input.running }),
  });
  return {
    state,
    canRun: plan.allowed && !input.running,
    blockedBecause: input.running ? "A research pass is already running." : plan.blockedBecause,
    plan,
  };
}

/**
 * The complete set of side effects one research run is permitted to have.
 * Scout observes and records; it never starts delivery work anywhere else.
 */
export const RESEARCH_RUN_SIDE_EFFECTS = ["prospect.researched"] as const;
