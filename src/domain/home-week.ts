/**
 * Trust Tai OS, Home / This Week (P2-04).
 *
 * Home answers one question: are we on pace this week? Under Today it shows
 * exactly four numbers, and those four are fixed by the locked commercial
 * definitions in `docs/production-plan.md`:
 *
 *   1. Revenue this week   - derived by the locked revenue law (Run from tier
 *                            state only, Diagnose from proposals signed in the
 *                            week, Build from dated tier-change events).
 *   2. First touches       - target 10 to 12.
 *   3. Discovery calls     - target 2 to 3.
 *   4. Diagnose proposals sent - target 1 to 2.
 *
 * Run clients is a standing state count, not a number this week produced, so
 * it belongs to the Clients book and is deliberately not one of the four.
 *
 * Laws this module keeps:
 *
 *   * Nothing here reads a clock, a database or a timezone. It is a pure
 *     projection of the one canonical weekly snapshot every room already uses
 *     (`readWeeklyScoreboard`), so Home can never disagree with Clients.
 *   * A source that could not be read is `unknown`, never zero. An empty
 *     source is a real zero and says so.
 *   * A floor is only breached below the low end of an agreed range. Revenue
 *     carries a goal, not a floor, so it never produces a floor breach.
 *   * Nothing computed here is written anywhere.
 */

import { formatMoney } from "./clients-book";
import type { FloorReading } from "./today-ordering";

/**
 * The shape Home needs from the canonical weekly snapshot. Structural on
 * purpose: `WeeklyScoreboard` satisfies it, and the domain stays free of the
 * data layer.
 */
export interface HomeWeekInput {
  targets: {
    firstTouchTargetLow: number;
    firstTouchTargetHigh: number;
    discoveryTargetLow: number;
    discoveryTargetHigh: number;
    diagnoseProposalsTargetLow: number;
    diagnoseProposalsTargetHigh: number;
    revenueTargetCents: number | null;
  };
  revenue: { totalCents: number } | null;
  firstTouches: number | null;
  discoveryCalls: number | null;
  proposalsSent: number | null;
  timeZone: string;
  timeZoneFallback: boolean;
  timeZoneBecause?: string | undefined;
}

export type HomeNumberKey = "revenue" | "first_touches" | "discovery_calls" | "proposals_sent";

/** The charter order, left to right. */
export const HOME_NUMBER_ORDER: HomeNumberKey[] = [
  "revenue",
  "first_touches",
  "discovery_calls",
  "proposals_sent",
];

export type HomeNumberState =
  /** The source could not be read. Never a zero. */
  | "unknown"
  /** Below the agreed low end of the range. */
  | "below_floor"
  /** Inside the agreed range, or at or above a single goal. */
  | "on_pace"
  /** Above the agreed high end. */
  | "ahead"
  /** Real number, but nothing was ever agreed to measure it against. */
  | "no_target";

export interface HomeNumber {
  key: HomeNumberKey;
  label: string;
  /** Null only when the state is `unknown`. */
  value: number | null;
  /** What a person reads. "Unknown" when the source could not be read. */
  display: string;
  /** The agreed range or goal, said plainly. Null when nothing was agreed. */
  targetLabel: string | null;
  state: HomeNumberState;
  /** Present only when the state is `unknown`: why it could not be read. */
  because?: string;
  /** The room that owns this truth. Home only ever links there. */
  slug: string;
  /** What the operator should do next about it. Never a dead end. */
  action: string;
}

function rangeLabel(low: number, high: number, noun: string): string | null {
  if (low <= 0 && high <= 0) return null;
  if (low === high) return `Target ${low} ${noun}`;
  return `Target ${low} to ${high} ${noun}`;
}

function rangeState(value: number, low: number, high: number): HomeNumberState {
  if (low <= 0 && high <= 0) return "no_target";
  if (low > 0 && value < low) return "below_floor";
  if (high > 0 && value > high) return "ahead";
  return "on_pace";
}

interface CountSpec {
  key: HomeNumberKey;
  label: string;
  noun: string;
  low: number;
  high: number;
  slug: string;
  action: string;
}

function countNumber(
  spec: CountSpec,
  value: number | null,
  because: string | undefined,
): HomeNumber {
  const targetLabel = rangeLabel(spec.low, spec.high, spec.noun);
  if (value === null) {
    return {
      key: spec.key,
      label: spec.label,
      value: null,
      display: "Unknown",
      targetLabel,
      state: "unknown",
      ...(because ? { because } : {}),
      slug: spec.slug,
      action: spec.action,
    };
  }
  return {
    key: spec.key,
    label: spec.label,
    value,
    display: String(value),
    targetLabel,
    state: rangeState(value, spec.low, spec.high),
    slug: spec.slug,
    action: spec.action,
  };
}

export interface HomeWeekSourceNotes {
  revenue?: string | undefined;
  firstTouches?: string | undefined;
  discoveryCalls?: string | undefined;
  proposalsSent?: string | undefined;
}

/** The four canonical This Week numbers, derived, in charter order. */
export function homeWeekNumbers(
  input: HomeWeekInput,
  notes: HomeWeekSourceNotes = {},
): HomeNumber[] {
  const t = input.targets;

  const goal = typeof t.revenueTargetCents === "number" ? t.revenueTargetCents : null;
  const revenue: HomeNumber =
    input.revenue === null
      ? {
          key: "revenue",
          label: "Revenue this week",
          value: null,
          display: "Unknown",
          targetLabel: goal !== null ? `Goal ${formatMoney(goal)}` : null,
          state: "unknown",
          ...(notes.revenue ? { because: notes.revenue } : {}),
          slug: "clients",
          action: "Open Clients to check tiers, amounts and signed proposals.",
        }
      : {
          key: "revenue",
          label: "Revenue this week",
          value: input.revenue.totalCents,
          display: formatMoney(input.revenue.totalCents) ?? "$0",
          targetLabel: goal !== null ? `Goal ${formatMoney(goal)}` : null,
          state:
            goal === null || goal <= 0
              ? "no_target"
              : input.revenue.totalCents < goal
                ? "below_floor"
                : "on_pace",
          slug: "clients",
          action: "Open Clients to check tiers, amounts and signed proposals.",
        };

  return [
    revenue,
    countNumber(
      {
        key: "first_touches",
        label: "First touches",
        noun: "",
        low: t.firstTouchTargetLow,
        high: t.firstTouchTargetHigh,
        slug: "comms",
        action: "Open Comms to reach someone we have never reached before.",
      },
      input.firstTouches,
      notes.firstTouches,
    ),
    countNumber(
      {
        key: "discovery_calls",
        label: "Discovery calls",
        noun: "",
        low: t.discoveryTargetLow,
        high: t.discoveryTargetHigh,
        slug: "comms",
        action: "Open Comms to log a discovery call that has already happened.",
      },
      input.discoveryCalls,
      notes.discoveryCalls,
    ),
    countNumber(
      {
        key: "proposals_sent",
        label: "Diagnose proposals sent",
        noun: "",
        low: t.diagnoseProposalsTargetLow,
        high: t.diagnoseProposalsTargetHigh,
        slug: "clients",
        action: "Open Clients to record a proposal on a real roadmap.",
      },
      input.proposalsSent,
      notes.proposalsSent,
    ),
  ].map((number) => ({
    ...number,
    targetLabel: number.targetLabel ? number.targetLabel.replace(/\s+$/, "") : null,
  }));
}

/**
 * The floor readings Today may treat as breaches. Only the three ranged
 * counting targets qualify: revenue carries a goal, not an agreed floor, and
 * a number that could not be read is not a breach, it is an unknown.
 */
export function homeFloorReadings(input: HomeWeekInput): FloorReading[] {
  const t = input.targets;
  const readings: FloorReading[] = [];

  if (input.firstTouches !== null) {
    readings.push({
      key: "floor-first-touches",
      label: "first touches below the agreed floor",
      actual: input.firstTouches,
      floor: t.firstTouchTargetLow,
      slug: "comms",
    });
  }
  if (input.discoveryCalls !== null) {
    readings.push({
      key: "floor-discovery-calls",
      label: "discovery calls below the agreed floor",
      actual: input.discoveryCalls,
      floor: t.discoveryTargetLow,
      slug: "comms",
    });
  }
  if (input.proposalsSent !== null) {
    readings.push({
      key: "floor-proposals-sent",
      label: "Diagnose proposals below the agreed floor",
      actual: input.proposalsSent,
      floor: t.diagnoseProposalsTargetLow,
      slug: "clients",
    });
  }

  return readings;
}

/** One honest sentence about which week this is, and in whose timezone. */
export function homeWeekNote(input: HomeWeekInput): string {
  if (input.timeZoneFallback) {
    return (
      input.timeZoneBecause ??
      `This organization has no timezone set, so the week is read in ${input.timeZone}.`
    );
  }
  return `Monday to Sunday, in ${input.timeZone.replace(/_/g, " ")}.`;
}

/** True when at least one of the four could not be read. */
export function hasUnreadableNumber(numbers: HomeNumber[]): boolean {
  return numbers.some((number) => number.state === "unknown");
}
