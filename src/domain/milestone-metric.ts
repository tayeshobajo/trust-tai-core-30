/**
 * Trust Tai OS, milestone outcome metric (P3-01).
 *
 * Measurement law, exactly as written in `docs/production-plan.md`:
 *
 *   "There is no single loose Point B number. A milestone outcome metric
 *    carries an identity or key, a label, a unit, a direction of
 *    increase | decrease | maintain, a baseline value with its date, and a
 *    target value with its date."
 *
 * Three rules hold here the way they hold everywhere else:
 *
 *  1. Roadmap owns this truth. Projects and every other room may project it,
 *     never write it.
 *  2. A metric is a human fact. It is always `decided`, carries who recorded
 *     it and when, and is never inferred from a model, a title or a document.
 *  3. Absence is absence. A milestone with no metric reads "No outcome metric
 *     yet", never 0, never a default unit, never a guessed direction.
 *
 * Measurements against the metric are P3-02 and are deliberately not modelled
 * here.
 */

import type { ID, ISODateTime } from "./entities";

/** Which way "better" points. There is no fourth direction. */
export type MetricDirection = "increase" | "decrease" | "maintain";

export const METRIC_DIRECTIONS: MetricDirection[] = ["increase", "decrease", "maintain"];

export const METRIC_DIRECTION_LABEL: Record<MetricDirection, string> = {
  increase: "Increase",
  decrease: "Decrease",
  maintain: "Maintain",
};

/** A value with the date it is true on. Date only: a metric is not a clock. */
export interface MetricPoint {
  value: number;
  /** ISO calendar date, `YYYY-MM-DD`. */
  at: string;
}

/**
 * The structured contract.
 *
 * People describe success. The system structures measurement: `key` is
 * generated from the human label rather than typed, `unit` may be empty when a
 * count needs no unit, and `baseline` may be absent because forcing a fake
 * starting value would be worse than having none.
 */
export interface OutcomeMetricInput {
  key: string;
  label: string;
  unit: string;
  direction: MetricDirection;
  baseline: MetricPoint | null;
  target: MetricPoint;
}

/** The stored fact, with its provenance attached. */
export interface OutcomeMetric extends OutcomeMetricInput {
  /** Always decided. A metric only exists because a person set it. */
  tier: "decided";
  recordedBy: ID;
  recordedAt: ISODateTime;
}

export type MetricCheck = { ok: true; metric: OutcomeMetricInput } | { ok: false; refusal: string };

export const NO_METRIC = "No outcome metric yet";

const KEY_SHAPE = /^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A key is an identity, so it is normalized rather than rejected for case or
 * spacing. Anything that cannot become a legible identity is refused.
 */
export function normalizeMetricKey(raw: string): string {
  return clean(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validDate(raw: string): boolean {
  if (!DATE_SHAPE.test(raw)) return false;
  const parsed = new Date(`${raw}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

function absent(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object") return false;
  return Object.keys(raw as Record<string, unknown>).length === 0;
}

function point(raw: unknown, name: string): MetricPoint | string {
  const source = (raw ?? {}) as Partial<MetricPoint>;
  const value = typeof source.value === "number" ? source.value : Number(clean(source.value));
  if (clean(source.value) === "" && typeof source.value !== "number") {
    return `A ${name} value is required. Nothing is assumed to be zero.`;
  }
  if (!Number.isFinite(value)) return `The ${name} value must be a number.`;
  const at = clean(source.at);
  if (!at) return `A ${name} date is required, so the number means something.`;
  if (!validDate(at)) return `The ${name} date must be a real calendar date, as YYYY-MM-DD.`;
  return { value, at };
}

/**
 * Fail closed. Nothing is invented: no default unit, no assumed direction, no
 * baseline of zero, no target copied from the baseline.
 */
export function checkOutcomeMetric(raw: Partial<OutcomeMetricInput>): MetricCheck {
  const key = normalizeMetricKey(clean(raw.key));
  if (!key)
    return { ok: false, refusal: "A metric key is required, for example `demo_to_close_rate`." };
  if (!KEY_SHAPE.test(key))
    return { ok: false, refusal: "That metric key is not a legible identity." };

  const label = clean(raw.label);
  if (!label)
    return { ok: false, refusal: "A label is required, so the number can be read by a person." };

  // A unit is optional: some targets are plain counts, and inventing "count"
  // for a person would be a fake default.
  const unit = clean(raw.unit);
  if (unit.length > 24)
    return { ok: false, refusal: "Keep the unit short, for example %, hours or GBP." };

  const direction = raw.direction as MetricDirection;
  if (!METRIC_DIRECTIONS.includes(direction)) {
    return { ok: false, refusal: "Choose a direction: increase, decrease or maintain." };
  }

  // No baseline is an honest state. A half typed baseline is still refused.
  let baseline: MetricPoint | null = null;
  if (!absent(raw.baseline)) {
    const read = point(raw.baseline, "baseline");
    if (typeof read === "string") return { ok: false, refusal: read };
    baseline = read;
  }
  const target = point(raw.target, "target");
  if (typeof target === "string") return { ok: false, refusal: target };

  if (baseline) {
    if (target.at < baseline.at) {
      return { ok: false, refusal: "The target date cannot be before the baseline date." };
    }
    if (direction === "increase" && target.value <= baseline.value) {
      return { ok: false, refusal: "An increase target must be above the baseline." };
    }
    if (direction === "decrease" && target.value >= baseline.value) {
      return { ok: false, refusal: "A decrease target must be below the baseline." };
    }
    if (direction === "maintain" && target.value !== baseline.value) {
      return { ok: false, refusal: "A maintain target must equal the baseline." };
    }
  }

  return { ok: true, metric: { key, label, unit, direction, baseline, target } };
}

/** Two metrics are the same fact when every stated field matches. */
export function sameMetric(
  a: OutcomeMetric | OutcomeMetricInput | null,
  b: OutcomeMetric | OutcomeMetricInput | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.key === b.key &&
    a.label === b.label &&
    a.unit === b.unit &&
    a.direction === b.direction &&
    (a.baseline?.value ?? null) === (b.baseline?.value ?? null) &&
    (a.baseline?.at ?? null) === (b.baseline?.at ?? null) &&
    a.target.value === b.target.value &&
    a.target.at === b.target.at
  );
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** One honest line. Absence stays absence. */
export function metricSummary(metric: OutcomeMetric | null | undefined): string {
  if (!metric) return NO_METRIC;
  const verb = METRIC_DIRECTION_LABEL[metric.direction].toLowerCase();
  const unit = metric.unit ? ` ${metric.unit}` : "";
  const from = metric.baseline
    ? ` from ${number(metric.baseline.value)}${unit} (${metric.baseline.at})`
    : "";
  return `${metric.label}: ${verb}${from} to ${number(metric.target.value)}${unit} by ${metric.target.at}`;
}

/** Read a stored jsonb value back, refusing anything that is not a whole metric. */
export function readOutcomeMetric(raw: unknown): OutcomeMetric | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const checked = checkOutcomeMetric({
    key: clean(row["key"]),
    label: clean(row["label"]),
    unit: clean(row["unit"]),
    direction: row["direction"] as MetricDirection,
    baseline: row["baseline"] as MetricPoint | null,
    target: row["target"] as MetricPoint,
  });
  if (!checked.ok) return null;
  const recordedBy = clean(row["recordedBy"]);
  const recordedAt = clean(row["recordedAt"]);
  if (!recordedBy || !recordedAt) return null;
  return { ...checked.metric, tier: "decided", recordedBy, recordedAt };
}

/** The stable key for "this metric was set to exactly this", used for dedupe. */
export function metricEventKey(milestoneId: ID, metric: OutcomeMetricInput | null): string {
  if (!metric) return `roadmap.metric_cleared:${milestoneId}`;
  const shape = [
    metric.key,
    metric.unit,
    metric.direction,
    metric.baseline?.value ?? "none",
    metric.baseline?.at ?? "none",
    metric.target.value,
    metric.target.at,
  ].join("|");
  return `roadmap.metric_set:${milestoneId}:${shape}`;
}

/* ---------------------------------------------- the light, human facing form */

/**
 * What a person types when a milestone genuinely needs a number.
 *
 * People describe success. The system structures measurement. Nobody is asked
 * for a metric key, and nobody is asked for a direction that the numbers
 * already state.
 */
export interface MeasurableTargetInput {
  label: string;
  unit?: string;
  targetValue: number | string;
  targetAt: string;
  baselineValue?: number | string;
  baselineAt?: string;
  /** Only needed when there is no baseline to infer the direction from. */
  direction?: MetricDirection | "";
}

/**
 * Which way better points, read off the two numbers a person already typed.
 * Returns null when there is nothing to read it from.
 */
export function inferDirection(
  baseline: MetricPoint | null,
  target: MetricPoint,
): MetricDirection | null {
  if (!baseline) return null;
  if (target.value > baseline.value) return "increase";
  if (target.value < baseline.value) return "decrease";
  return "maintain";
}

/**
 * Turn the light form into the full stored contract, generating the key from
 * the label and inferring the direction wherever the numbers allow it.
 */
export function checkMeasurableTarget(raw: Partial<MeasurableTargetInput>): MetricCheck {
  const label = clean(raw.label);
  if (!label) {
    return { ok: false, refusal: "Name what you are measuring, for example Demo to close rate." };
  }
  const key = normalizeMetricKey(label);
  if (!key || !KEY_SHAPE.test(key)) {
    return { ok: false, refusal: "Use letters or numbers in the name, so it can be stored." };
  }

  const hasBaselineValue = typeof raw.baselineValue === "number" || clean(raw.baselineValue) !== "";
  const hasBaselineDate = clean(raw.baselineAt) !== "";
  const baselineGiven = hasBaselineValue || hasBaselineDate;

  const target = point({ value: raw.targetValue, at: raw.targetAt }, "target");
  if (typeof target === "string") return { ok: false, refusal: target };

  let baseline: MetricPoint | null = null;
  if (baselineGiven) {
    const read = point({ value: raw.baselineValue, at: raw.baselineAt }, "starting point");
    if (typeof read === "string") return { ok: false, refusal: read };
    baseline = read;
  }

  const inferred = inferDirection(baseline, target);
  const direction = inferred ?? (raw.direction as MetricDirection);
  if (!METRIC_DIRECTIONS.includes(direction)) {
    return {
      ok: false,
      refusal:
        "With no starting point to compare against, say whether this should increase, decrease or stay the same.",
    };
  }

  return checkOutcomeMetric({
    key,
    label,
    unit: clean(raw.unit),
    direction,
    baseline,
    target,
  });
}
