/**
 * Trust Tai OS, revenue derivation.
 *
 * The locked law, in executable form:
 *
 *   * Run weekly = `mrr_cents * 12 / 52`, derived at read time, never divided
 *     by 4 or 4.345, never persisted.
 *   * Diagnose is recognised in full in the week of `proposal.signed`, at the
 *     proposal amount.
 *   * Build is recognised in full in the week of `client.tier_changed -> build`,
 *     at the human-entered phase amount.
 *   * One-off revenue is an event. Recurring revenue is state.
 *   * A signed proposal never inflates Run until the tier actually changes to
 *     Run: Run reads tier state only, and never reads a proposal.
 *
 * Everything here is pure and rounds only at the display boundary.
 */

import type { ClientCommercialState } from "./commercial";
import type { ISODateTime } from "./entities";

/** A week runs Monday 00:00 UTC to the following Monday, exclusive. */
export interface WeekWindow {
  start: ISODateTime;
  /** Exclusive. */
  end: ISODateTime;
}

/** The Monday-start UTC week containing the given instant. */
export function weekWindow(at: Date | string): WeekWindow {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) throw new Error("A week needs a real date.");
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
  // getUTCDay: Sunday is 0, so Sunday belongs to the week that began six days back.
  const offset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - offset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function isInWeek(at: ISODateTime | null | undefined, week: WeekWindow): boolean {
  if (!at) return false;
  const value = new Date(at).getTime();
  if (Number.isNaN(value)) return false;
  return value >= new Date(week.start).getTime() && value < new Date(week.end).getTime();
}

/**
 * Recurring revenue for one week, in exact cents as a real number. The caller
 * rounds for display and nothing persists the result.
 */
export function runWeeklyCents(mrrCents: number | null | undefined): number {
  if (typeof mrrCents !== "number" || !Number.isFinite(mrrCents)) return 0;
  return (mrrCents * 12) / 52;
}

/** The only place a derived revenue number is allowed to lose precision. */
export function displayCents(value: number): number {
  return Math.round(value);
}

/* --------------------------------------------------------- one-off evidence */

/** A `proposal.signed` event, reduced to the facts revenue depends on. */
export interface SignedProposalEvent {
  occurredAt: ISODateTime;
  amountCents: number | null;
}

/** A `client.tier_changed -> build` event with its human-entered phase amount. */
export interface BuildPhaseEvent {
  occurredAt: ISODateTime;
  phaseAmountCents: number | null;
}

export interface WeeklyRevenueInput {
  week: WeekWindow;
  /** Commercial state of every client. Run reads this and nothing else. */
  clients: Pick<ClientCommercialState, "tier" | "mrrCents">[];
  signedProposals?: SignedProposalEvent[];
  buildPhases?: BuildPhaseEvent[];
}

export interface WeeklyRevenue {
  /** Recurring, derived from tier `run` state only. */
  runCents: number;
  /** One-off, recognised in the week of `proposal.signed`. */
  diagnoseCents: number;
  /** One-off, recognised in the week of `client.tier_changed -> build`. */
  buildCents: number;
  totalCents: number;
}

function sumAmounts(
  entries: { occurredAt: ISODateTime; amount: number | null }[],
  week: WeekWindow,
): number {
  return entries.reduce((total, entry) => {
    if (!isInWeek(entry.occurredAt, week)) return total;
    if (typeof entry.amount !== "number" || !Number.isFinite(entry.amount)) return total;
    return total + entry.amount;
  }, 0);
}

/** Everything a week earned, derived at read time. Nothing here is stored. */
export function weeklyRevenue(input: WeeklyRevenueInput): WeeklyRevenue {
  const runCents = input.clients.reduce(
    (total, client) => (client.tier === "run" ? total + runWeeklyCents(client.mrrCents) : total),
    0,
  );
  const diagnoseCents = sumAmounts(
    (input.signedProposals ?? []).map((event) => ({
      occurredAt: event.occurredAt,
      amount: event.amountCents,
    })),
    input.week,
  );
  const buildCents = sumAmounts(
    (input.buildPhases ?? []).map((event) => ({
      occurredAt: event.occurredAt,
      amount: event.phaseAmountCents,
    })),
    input.week,
  );
  return {
    runCents,
    diagnoseCents,
    buildCents,
    totalCents: runCents + diagnoseCents + buildCents,
  };
}
