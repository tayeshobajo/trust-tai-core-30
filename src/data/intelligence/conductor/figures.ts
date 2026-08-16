/**
 * Recorded figures, read honestly.
 *
 * These are the numbers no room in the suite can count: cash, burn, money
 * owed, and the two planning inputs a business often knows before it
 * instruments them. A person records them; this module decides what may
 * still be said about them today.
 *
 * Two rules do all the work. A figure older than {@link FIGURE_EXPIRY_DAYS}
 * is not a figure any more — it returns to unknown rather than steering the
 * business on a stale bank balance. A figure older than
 * {@link FIGURE_STALE_DAYS} may still be used, but never reads healthy.
 */

import type { EvidenceRef } from "@/domain/confidence";
import {
  FIGURE_EXPIRY_DAYS,
  FIGURE_STALE_DAYS,
  figureInput,
  type BusinessFigure,
  type ValueBasis,
  type VitalStanding,
} from "@/domain/conductor";

const DAY = 86_400_000;

export function figureAgeDays(figure: BusinessFigure, now: string): number {
  const a = new Date(figure.asOf).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((b - a) / DAY));
}

/** The freshest usable figure for a key, or nothing. Expiry is not a warning. */
export function currentFigure(
  figures: BusinessFigure[],
  key: string,
  now: string,
): BusinessFigure | undefined {
  return figures
    .filter((row) => row.key === key && figureAgeDays(row, now) <= FIGURE_EXPIRY_DAYS)
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))[0];
}

export interface FigureReading {
  key: string;
  value: number;
  basis: ValueBasis;
  standing: VitalStanding;
  statement: string;
  because: string;
  evidence: EvidenceRef[];
  stale: boolean;
}

function label(key: string): string {
  return figureInput(key)?.label ?? key.replace(/_/g, " ");
}

/**
 * One usable figure, phrased. `standing` here is only about the figure's
 * freshness and sign — judging it against a target is the vitals layer's job.
 */
export function readFigure(
  figures: BusinessFigure[],
  key: string,
  now: string,
): FigureReading | undefined {
  const figure = currentFigure(figures, key, now);
  if (!figure) return undefined;
  const age = figureAgeDays(figure, now);
  const stale = age > FIGURE_STALE_DAYS;
  const unit = figure.unit ?? figureInput(key)?.unit ?? "";
  return {
    key,
    value: figure.value,
    basis: figure.basis,
    standing: stale ? "watch" : "healthy",
    statement: `${label(key)}: ${figure.value}${unit ? ` ${unit}` : ""}.`,
    because: stale
      ? `Recorded by ${figure.recordedBy.label}, true as of ${age} days ago. Old enough that it should be confirmed before anything is decided on it.`
      : `Recorded by ${figure.recordedBy.label}, true as of ${age} day${age === 1 ? "" : "s"} ago.`,
    evidence: [
      {
        label: `${label(key)} recorded by ${figure.recordedBy.label}`,
        kind: figure.basis === "decided" ? "human" : "computed",
      },
    ],
    stale,
  };
}

/**
 * Runway, worked out rather than asked for.
 *
 * Cash divided by burn. Both inputs must be present and usable, and burn must
 * be positive — a business with no recorded burn does not have infinite
 * runway, it has an unrecorded one.
 */
export function deriveRunway(
  figures: BusinessFigure[],
  now: string,
): FigureReading | undefined {
  const cash = currentFigure(figures, "cash_on_hand", now);
  const burn = currentFigure(figures, "monthly_burn", now);
  if (!cash || !burn || burn.value <= 0) return undefined;

  const months = Math.round((cash.value / burn.value) * 10) / 10;
  const stale = Math.max(figureAgeDays(cash, now), figureAgeDays(burn, now)) > FIGURE_STALE_DAYS;
  return {
    key: "cash_runway",
    value: months,
    /* Arithmetic over decided inputs is inferred, never observed. */
    basis: "inferred",
    standing: months < 3 ? "at_risk" : months < 6 || stale ? "watch" : "healthy",
    statement: `Runway: ${months} month${months === 1 ? "" : "s"} at the current burn.`,
    because: `${cash.value} cash ÷ ${burn.value} monthly burn = ${months} months. Both figures were recorded by hand${stale ? ", and at least one is old enough to need confirming" : ""}.`,
    evidence: [
      { label: `Cash recorded by ${cash.recordedBy.label}`, kind: "human" },
      { label: `Burn recorded by ${burn.recordedBy.label}`, kind: "human" },
    ],
    stale,
  };
}

/** Every figure-backed reading available today, runway included. */
export function readFigures(figures: BusinessFigure[], now: string): FigureReading[] {
  const keys = ["recurring_revenue", "receivables", "average_deal_size", "close_rate", "sales_cycle"];
  const readings = keys
    .map((key) => readFigure(figures, key, now))
    .filter((row): row is FigureReading => row !== undefined);
  const runway = deriveRunway(figures, now);
  return runway ? [runway, ...readings] : readings;
}
