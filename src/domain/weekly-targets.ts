/**
 * Trust Tai OS, organization weekly targets.
 *
 * Configuration only. A target says what a good week looks like; it never
 * holds an actual. Weekly actuals are derived at read time from state and
 * events (see `revenue.ts` and `discovery.ts`) and are never persisted.
 */

import type { ID, ISODateTime } from "./entities";

export interface WeeklyTargets {
  firstTouchTargetLow: number;
  firstTouchTargetHigh: number;
  discoveryTargetLow: number;
  discoveryTargetHigh: number;
  diagnoseProposalsTargetLow: number;
  diagnoseProposalsTargetHigh: number;
  runClientsTarget: number;
  /** Display only. A goal, never an actual, and never a derived number. */
  revenueTargetCents: number | null;
}

export interface WeeklyTargetsRecord extends WeeklyTargets {
  id: ID;
  organizationId: ID;
  version: number;
  updatedAt: ISODateTime | null;
  updatedBy: ID | null;
}

/** The locked commercial definitions, used when an organization has no row. */
export const DEFAULT_WEEKLY_TARGETS: WeeklyTargets = {
  firstTouchTargetLow: 10,
  firstTouchTargetHigh: 12,
  discoveryTargetLow: 2,
  discoveryTargetHigh: 3,
  diagnoseProposalsTargetLow: 1,
  diagnoseProposalsTargetHigh: 2,
  runClientsTarget: 20,
  revenueTargetCents: null,
};

function asCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** Read a raw `organization_weekly_targets` row, falling back to the defaults. */
export function readWeeklyTargets(row: Record<string, unknown> | null): WeeklyTargets {
  if (!row) return { ...DEFAULT_WEEKLY_TARGETS };
  const revenue = row["revenue_target_cents"];
  return {
    firstTouchTargetLow: asCount(
      row["first_touch_target_low"],
      DEFAULT_WEEKLY_TARGETS.firstTouchTargetLow,
    ),
    firstTouchTargetHigh: asCount(
      row["first_touch_target_high"],
      DEFAULT_WEEKLY_TARGETS.firstTouchTargetHigh,
    ),
    discoveryTargetLow: asCount(
      row["discovery_target_low"],
      DEFAULT_WEEKLY_TARGETS.discoveryTargetLow,
    ),
    discoveryTargetHigh: asCount(
      row["discovery_target_high"],
      DEFAULT_WEEKLY_TARGETS.discoveryTargetHigh,
    ),
    diagnoseProposalsTargetLow: asCount(
      row["diagnose_proposals_target_low"],
      DEFAULT_WEEKLY_TARGETS.diagnoseProposalsTargetLow,
    ),
    diagnoseProposalsTargetHigh: asCount(
      row["diagnose_proposals_target_high"],
      DEFAULT_WEEKLY_TARGETS.diagnoseProposalsTargetHigh,
    ),
    runClientsTarget: asCount(row["run_clients_target"], DEFAULT_WEEKLY_TARGETS.runClientsTarget),
    revenueTargetCents:
      typeof revenue === "number" && Number.isFinite(revenue) ? Math.trunc(revenue) : null,
  };
}
