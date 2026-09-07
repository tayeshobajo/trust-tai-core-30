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

/** What a person types. Nothing here is generated. */
export interface OutcomeMetricInput {
  key: string;
  label: string;
  unit: string;
  direction: MetricDirection;
  baseline: MetricPoint;
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

  const unit = clean(raw.unit);
  if (!unit)
    return { ok: false, refusal: "A unit is required. A number without a unit is not a metric." };
  if (unit.length > 24)
    return { ok: false, refusal: "Keep the unit short, for example %, hours or GBP." };

  const direction = raw.direction as MetricDirection;
  if (!METRIC_DIRECTIONS.includes(direction)) {
    return { ok: false, refusal: "Choose a direction: increase, decrease or maintain." };
  }

  const baseline = point(raw.baseline, "baseline");
  if (typeof baseline === "string") return { ok: false, refusal: baseline };
  const target = point(raw.target, "target");
  if (typeof target === "string") return { ok: false, refusal: target };

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
    a.baseline.value === b.baseline.value &&
    a.baseline.at === b.baseline.at &&
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
  return `${metric.label}: ${verb} from ${number(metric.baseline.value)} ${metric.unit} (${metric.baseline.at}) to ${number(metric.target.value)} ${metric.unit} by ${metric.target.at}`;
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
    baseline: row["baseline"] as MetricPoint,
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
    metric.baseline.value,
    metric.baseline.at,
    metric.target.value,
    metric.target.at,
  ].join("|");
  return `roadmap.metric_set:${milestoneId}:${shape}`;
}
