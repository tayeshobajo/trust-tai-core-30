/**
 * The light, human facing measurable target: people describe success, the
 * system structures measurement.
 */

import { describe, expect, it } from "vitest";

import { checkMeasurableTarget, inferDirection } from "./milestone-metric";

describe("measurable target, the light form", () => {
  it("generates the metric key from the label, never asking a person for it", () => {
    const checked = checkMeasurableTarget({
      label: "Demo to close rate",
      unit: "%",
      baselineValue: 12,
      baselineAt: "2026-09-01",
      targetValue: 25,
      targetAt: "2026-12-01",
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.metric.key).toBe("demo_to_close_rate");
  });

  it("infers the direction from the two numbers a person already typed", () => {
    const up = checkMeasurableTarget({
      label: "Signed clients",
      baselineValue: 4,
      baselineAt: "2026-09-01",
      targetValue: 9,
      targetAt: "2026-12-01",
    });
    expect(up.ok && up.metric.direction).toBe("increase");

    const down = checkMeasurableTarget({
      label: "Support backlog",
      baselineValue: 40,
      baselineAt: "2026-09-01",
      targetValue: 10,
      targetAt: "2026-12-01",
    });
    expect(down.ok && down.metric.direction).toBe("decrease");

    expect(inferDirection({ value: 5, at: "2026-09-01" }, { value: 5, at: "2026-12-01" })).toBe(
      "maintain",
    );
    expect(inferDirection(null, { value: 5, at: "2026-12-01" })).toBeNull();
  });

  it("only asks for a direction when there is no starting point to read it from", () => {
    const asked = checkMeasurableTarget({
      label: "Signed clients",
      targetValue: 9,
      targetAt: "2026-12-01",
    });
    expect(asked.ok).toBe(false);

    const answered = checkMeasurableTarget({
      label: "Signed clients",
      targetValue: 9,
      targetAt: "2026-12-01",
      direction: "increase",
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.metric.baseline).toBeNull();
  });

  it("leaves the unit empty rather than inventing one", () => {
    const checked = checkMeasurableTarget({
      label: "Pages approved",
      baselineValue: 0,
      baselineAt: "2026-09-01",
      targetValue: 7,
      targetAt: "2026-09-30",
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.metric.unit).toBe("");
  });

  it("keeps a real zero as a starting point", () => {
    const checked = checkMeasurableTarget({
      label: "Pages approved",
      baselineValue: 0,
      baselineAt: "2026-09-01",
      targetValue: 7,
      targetAt: "2026-09-30",
    });
    expect(checked.ok && checked.metric.baseline?.value).toBe(0);
  });

  it("refuses a half typed starting point and an unnamed measurement", () => {
    expect(
      checkMeasurableTarget({
        label: "Pages approved",
        baselineAt: "2026-09-01",
        targetValue: 7,
        targetAt: "2026-09-30",
      }).ok,
    ).toBe(false);
    expect(checkMeasurableTarget({ label: " ", targetValue: 7, targetAt: "2026-09-30" }).ok).toBe(
      false,
    );
  });

  it("still requires a target date, and never fills one in", () => {
    expect(
      checkMeasurableTarget({ label: "Pages approved", targetValue: 7, direction: "increase" }).ok,
    ).toBe(false);
  });
});
