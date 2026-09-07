import { describe, expect, it } from "vitest";

import {
  NO_METRIC,
  checkOutcomeMetric,
  metricEventKey,
  metricSummary,
  normalizeMetricKey,
  readOutcomeMetric,
  sameMetric,
  type OutcomeMetric,
} from "./milestone-metric";

const good = {
  key: "Demo to close rate",
  label: "Demo to close rate",
  unit: "%",
  direction: "increase" as const,
  baseline: { value: 12, at: "2026-09-01" },
  target: { value: 25, at: "2026-12-01" },
};

describe("milestone outcome metric", () => {
  it("accepts a whole human metric and normalizes the key", () => {
    const result = checkOutcomeMetric(good);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metric.key).toBe("demo_to_close_rate");
    expect(result.metric.direction).toBe("increase");
  });

  it("refuses a missing key, label or direction", () => {
    for (const patch of [{ key: "" }, { label: " " }, { direction: "up" as never }]) {
      const result = checkOutcomeMetric({ ...good, ...patch });
      expect(result.ok).toBe(false);
    }
  });

  it("never assumes a baseline of zero when the value is missing", () => {
    const result = checkOutcomeMetric({ ...good, baseline: { at: "2026-09-01" } as never });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain("baseline value is required");
  });

  it("keeps a real zero baseline", () => {
    const result = checkOutcomeMetric({ ...good, baseline: { value: 0, at: "2026-09-01" } });
    expect(result.ok).toBe(true);
  });

  it("requires real dates and a target date that is not earlier", () => {
    expect(checkOutcomeMetric({ ...good, target: { value: 25, at: "2026-13-40" } }).ok).toBe(false);
    expect(checkOutcomeMetric({ ...good, target: { value: 25, at: "2026-08-01" } }).ok).toBe(false);
  });

  it("holds direction against the numbers", () => {
    expect(checkOutcomeMetric({ ...good, target: { value: 4, at: "2026-12-01" } }).ok).toBe(false);
    expect(
      checkOutcomeMetric({ ...good, direction: "decrease", target: { value: 4, at: "2026-12-01" } })
        .ok,
    ).toBe(true);
    expect(
      checkOutcomeMetric({ ...good, direction: "maintain", target: { value: 12, at: "2026-12-01" } })
        .ok,
    ).toBe(true);
    expect(checkOutcomeMetric({ ...good, direction: "maintain" }).ok).toBe(false);
  });

  it("reads absence as absence, not zero", () => {
    expect(readOutcomeMetric(null)).toBeNull();
    expect(readOutcomeMetric({})).toBeNull();
    expect(metricSummary(null)).toBe(NO_METRIC);
  });

  it("refuses a stored value with no provenance", () => {
    expect(readOutcomeMetric({ ...good, key: "demo_to_close_rate" })).toBeNull();
    const stored = readOutcomeMetric({
      ...good,
      key: "demo_to_close_rate",
      recordedBy: "user-1",
      recordedAt: "2026-09-06T10:00:00.000Z",
    });
    expect(stored?.tier).toBe("decided");
    expect(stored?.recordedBy).toBe("user-1");
  });

  it("summarises one honest line", () => {
    const metric: OutcomeMetric = {
      ...good,
      key: "demo_to_close_rate",
      tier: "decided",
      recordedBy: "user-1",
      recordedAt: "2026-09-06T10:00:00.000Z",
    };
    expect(metricSummary(metric)).toBe(
      "Demo to close rate: increase from 12 % (2026-09-01) to 25 % by 2026-12-01",
    );
  });

  it("treats an unchanged metric as the same fact and the same event", () => {
    const a = checkOutcomeMetric(good);
    const b = checkOutcomeMetric({ ...good, key: "demo to close rate" });
    if (!a.ok || !b.ok) throw new Error("expected valid");
    expect(sameMetric(a.metric, b.metric)).toBe(true);
    expect(metricEventKey("m1", a.metric)).toBe(metricEventKey("m1", b.metric));
    expect(metricEventKey("m1", { ...a.metric, target: { value: 30, at: "2026-12-01" } })).not.toBe(
      metricEventKey("m1", a.metric),
    );
    expect(metricEventKey("m1", null)).toContain("cleared");
  });

  it("normalizes keys without inventing one", () => {
    expect(normalizeMetricKey("  Hours saved / week ")).toBe("hours_saved_week");
    expect(normalizeMetricKey("   ")).toBe("");
  });
});
