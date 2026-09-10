/**
 * Trust Tai OS, milestone outcome measurement (P3-02).
 *
 * A measurement is one reading of an existing outcome metric on one day, typed
 * by a person, with the evidence they read it from.
 *
 * The laws that hold here:
 *
 *  1. Roadmap owns measurement truth. Projects may operate it only through the
 *     Roadmap service (Canon 17). There is no second measurement store.
 *  2. A measurement is evidence, never a guess. No value is defaulted, no date
 *     falls back to today, no source is invented, and nothing is inferred from
 *     a model.
 *  3. A measurement never touches the metric. Baseline and target belong to the
 *     metric contract (P3-01) and are read, never written, from here.
 *  4. Absence is absence. No metric means no measurement, and the person is
 *     told to set the metric first rather than shown a zero.
 *  5. History is append only. A reading that was true on a day stays on record.
 */

import type { ID, ISODateTime } from "./entities";
import type { OutcomeMetric } from "./milestone-metric";

/** What a person types. Nothing here is generated. */
export interface MeasurementInput {
  value: number;
  /** ISO calendar date, `YYYY-MM-DD`. The day the reading is true for. */
  measuredAt: string;
  /** Where the number was read from, in the person's own words. */
  source: string;
}

/** The stored reading, with the actor and the metric it belongs to. */
export interface MilestoneMeasurement extends MeasurementInput {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  milestoneId: ID;
  /** Identity of the metric this reading measured, never its whole contract. */
  metricKey: string;
  recordedBy: ID;
  recordedAt: ISODateTime;
  /** Replay protection: the same reading recorded twice is one measurement. */
  sourceEventKey: string;
}

export type MeasurementCheck =
  { ok: true; measurement: MeasurementInput } | { ok: false; refusal: string };

export const NO_METRIC_FOR_MEASUREMENT = "Add an outcome metric before recording a measurement.";

export const NO_MEASUREMENTS = "No measurement recorded yet";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Words that look like a source but say nothing. A source has to point at
 * something a second person could go and check.
 */
const PLACEHOLDERS = new Set([
  "manual",
  "manually",
  "n/a",
  "na",
  "none",
  "nil",
  "test",
  "tbc",
  "tbd",
  "unknown",
  "source",
  "-",
  "--",
]);

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(raw: string): boolean {
  if (!DATE_SHAPE.test(raw)) return false;
  const parsed = new Date(`${raw}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

/** The stored instant for a measured day: noon UTC, as everywhere else here. */
export function measuredInstant(day: string): ISODateTime {
  return `${day}T12:00:00.000Z`;
}

/** Read a stored instant back as the calendar day it was true for. */
export function measuredDay(raw: unknown): string {
  const value = clean(raw);
  if (DATE_SHAPE.test(value.slice(0, 10))) return value.slice(0, 10);
  return "";
}

/**
 * Fail closed, before the database is touched.
 *
 * Zero is a real reading and is accepted. Everything else that is missing,
 * unreadable or empty is refused with a sentence a person can act on.
 */
export function checkMeasurement(
  metric: OutcomeMetric | null | undefined,
  raw: Partial<MeasurementInput>,
): MeasurementCheck {
  if (!metric) return { ok: false, refusal: NO_METRIC_FOR_MEASUREMENT };

  const typed = raw.value;
  const empty = typeof typed !== "number" && clean(typed) === "";
  if (empty) {
    return { ok: false, refusal: "A value is required. Nothing is assumed to be zero." };
  }
  const value = typeof typed === "number" ? typed : Number(clean(typed));
  if (!Number.isFinite(value)) return { ok: false, refusal: "The value must be a number." };

  const measuredAt = clean(raw.measuredAt);
  if (!measuredAt) {
    return {
      ok: false,
      refusal: "A measured date is required. Today is never assumed for you.",
    };
  }
  if (!validDate(measuredAt)) {
    return { ok: false, refusal: "The measured date must be a real calendar date, as YYYY-MM-DD." };
  }

  const source = clean(raw.source);
  if (!source) {
    return { ok: false, refusal: "A source is required, so the number can be checked." };
  }
  if (PLACEHOLDERS.has(source.toLowerCase()) || source.length < 3) {
    return {
      ok: false,
      refusal: "Name where the number came from, for example the Stripe dashboard or GA4.",
    };
  }
  if (source.length > 160) {
    return { ok: false, refusal: "Keep the source to a short, checkable reference." };
  }

  return { ok: true, measurement: { value, measuredAt, source } };
}

/** The stable key for "this exact reading", used for replay protection. */
export function measurementEventKey(
  milestoneId: ID,
  metricKey: string,
  measurement: MeasurementInput,
): string {
  const shape = [metricKey, measurement.measuredAt, measurement.value, measurement.source].join(
    "|",
  );
  return `roadmap.measured:${milestoneId}:${shape}`;
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** One honest line for a reading. */
export function measurementSummary(
  measurement: MilestoneMeasurement,
  metric: OutcomeMetric | null | undefined,
): string {
  const unit = metric?.unit ? ` ${metric.unit}` : "";
  return `${number(measurement.value)}${unit} on ${measurement.measuredAt}, from ${measurement.source}`;
}

/**
 * Newest first, deterministically: by the day the reading is true for, then by
 * when it was recorded, then by id so equal readings never swap places.
 */
export function sortMeasurements(rows: MilestoneMeasurement[]): MilestoneMeasurement[] {
  return [...rows].sort((a, b) => {
    if (a.measuredAt !== b.measuredAt) return a.measuredAt < b.measuredAt ? 1 : -1;
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * How far a reading is from baseline to target, as a whole percentage.
 *
 * Deterministic arithmetic on two numbers a person typed, never a trend and
 * never a forecast. A maintain metric has no distance to travel, so it returns
 * nothing rather than a made up 100, and a metric with no starting point has
 * nothing to measure progress from.
 */
export function progressTowardTarget(
  metric: OutcomeMetric | null | undefined,
  value: number,
): number | null {
  if (!metric || !metric.baseline) return null;
  const span = metric.target.value - metric.baseline.value;
  if (span === 0) return null;
  const travelled = (value - metric.baseline.value) / span;
  return Math.round(travelled * 100);
}
