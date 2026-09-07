/**
 * Measurement law (P3-02). What a person may record, and what is refused
 * before anything reaches the database.
 */

import { describe, expect, it } from "vitest";

import {
  NO_METRIC_FOR_MEASUREMENT,
  checkMeasurement,
  measuredDay,
  measuredInstant,
  measurementEventKey,
  progressTowardTarget,
  sortMeasurements,
  type MilestoneMeasurement,
} from "./milestone-measurement";
import type { OutcomeMetric } from "./milestone-metric";

const METRIC: OutcomeMetric = {
  key: "demo_to_close_rate",
  label: "Demo to close rate",
  unit: "%",
  direction: "increase",
  baseline: { value: 12, at: "2026-09-01" },
  target: { value: 25, at: "2026-12-01" },
  tier: "decided",
  recordedBy: "user-1",
  recordedAt: "2026-09-01T10:00:00.000Z",
};

const GOOD = { value: 18, measuredAt: "2026-09-15", source: "Stripe dashboard" };

describe("checkMeasurement", () => {
  it("accepts a reading a person typed", () => {
    const checked = checkMeasurement(METRIC, GOOD);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.measurement.value).toBe(18);
  });

  it("accepts zero as a real reading", () => {
    const checked = checkMeasurement(METRIC, { ...GOOD, value: 0 });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.measurement.value).toBe(0);
  });

  it("refuses a measurement when the milestone has no metric", () => {
    const checked = checkMeasurement(null, GOOD);
    expect(checked).toEqual({ ok: false, refusal: NO_METRIC_FOR_MEASUREMENT });
  });

  it("refuses a missing value rather than assuming zero", () => {
    const checked = checkMeasurement(METRIC, { ...GOOD, value: "" as unknown as number });
    expect(checked.ok).toBe(false);
  });

  it("refuses a value that is not a number", () => {
    const checked = checkMeasurement(METRIC, { ...GOOD, value: "soon" as unknown as number });
    expect(checked.ok).toBe(false);
  });

  it("refuses a missing measured date rather than defaulting to today", () => {
    const checked = checkMeasurement(METRIC, { ...GOOD, measuredAt: "" });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.refusal).toContain("Today is never assumed");
  });

  it("refuses an unreal measured date", () => {
    expect(checkMeasurement(METRIC, { ...GOOD, measuredAt: "2026-02-31" }).ok).toBe(false);
    expect(checkMeasurement(METRIC, { ...GOOD, measuredAt: "15/09/2026" }).ok).toBe(false);
  });

  it("refuses a missing source", () => {
    expect(checkMeasurement(METRIC, { ...GOOD, source: "   " }).ok).toBe(false);
  });

  it("refuses a placeholder source that says nothing", () => {
    for (const source of ["manual", "n/a", "TBD", "-"]) {
      expect(checkMeasurement(METRIC, { ...GOOD, source }).ok).toBe(false);
    }
  });

  it("trims the source it accepts", () => {
    const checked = checkMeasurement(METRIC, { ...GOOD, source: "  GA4 report  " });
    expect(checked.ok && checked.measurement.source).toBe("GA4 report");
  });
});

describe("replay key", () => {
  it("is stable for the same reading and different for a different one", () => {
    const key = measurementEventKey("m-1", METRIC.key, GOOD);
    expect(measurementEventKey("m-1", METRIC.key, { ...GOOD })).toBe(key);
    expect(measurementEventKey("m-1", METRIC.key, { ...GOOD, value: 19 })).not.toBe(key);
    expect(measurementEventKey("m-2", METRIC.key, GOOD)).not.toBe(key);
  });
});

describe("day storage", () => {
  it("stores a day at noon UTC and reads it back as the same day", () => {
    expect(measuredInstant("2026-09-15")).toBe("2026-09-15T12:00:00.000Z");
    expect(measuredDay("2026-09-15T12:00:00.000Z")).toBe("2026-09-15");
    expect(measuredDay(null)).toBe("");
  });
});

function row(overrides: Partial<MilestoneMeasurement>): MilestoneMeasurement {
  return {
    id: "a",
    organizationId: "org-1",
    roadmapId: "r-1",
    milestoneId: "m-1",
    metricKey: METRIC.key,
    value: 1,
    measuredAt: "2026-09-01",
    source: "Stripe",
    recordedBy: "user-1",
    recordedAt: "2026-09-01T12:00:00.000Z",
    sourceEventKey: "k",
    ...overrides,
  };
}

describe("history ordering", () => {
  it("is newest first and deterministic", () => {
    const sorted = sortMeasurements([
      row({ id: "a", measuredAt: "2026-09-01" }),
      row({ id: "c", measuredAt: "2026-09-20" }),
      row({ id: "b", measuredAt: "2026-09-10" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
  });

  it("breaks a tie by when it was recorded, then by id", () => {
    const sorted = sortMeasurements([
      row({ id: "a", recordedAt: "2026-09-02T09:00:00.000Z" }),
      row({ id: "b", recordedAt: "2026-09-02T11:00:00.000Z" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("derived progress", () => {
  it("is plain arithmetic on the metric a person set", () => {
    expect(progressTowardTarget(METRIC, 12)).toBe(0);
    expect(progressTowardTarget(METRIC, 25)).toBe(100);
  });

  it("says nothing when there is nothing to derive", () => {
    expect(progressTowardTarget(null, 10)).toBeNull();
    expect(
      progressTowardTarget(
        { ...METRIC, direction: "maintain", target: { value: 12, at: "2026-12-01" } },
        12,
      ),
    ).toBeNull();
  });
});
