import { describe, expect, it } from "vitest";

import {
  displayCents,
  isInWeek,
  runWeeklyCents,
  weeklyRevenue,
  weekWindow,
} from "./revenue";

describe("weekWindow", () => {
  it("starts on Monday 00:00 UTC", () => {
    const week = weekWindow("2026-09-03T15:22:00.000Z"); // a Thursday
    expect(week.start).toBe("2026-08-31T00:00:00.000Z");
    expect(week.end).toBe("2026-09-07T00:00:00.000Z");
  });

  it("puts Sunday in the week that began six days earlier", () => {
    const week = weekWindow("2026-09-06T23:59:59.000Z");
    expect(week.start).toBe("2026-08-31T00:00:00.000Z");
  });

  it("treats the end of the window as exclusive", () => {
    const week = weekWindow("2026-09-03T00:00:00.000Z");
    expect(isInWeek("2026-09-06T23:59:59.999Z", week)).toBe(true);
    expect(isInWeek("2026-09-07T00:00:00.000Z", week)).toBe(false);
    expect(isInWeek(null, week)).toBe(false);
  });
});

describe("runWeeklyCents", () => {
  it("uses mrr * 12 / 52 and never a quarter of a month", () => {
    const mrr = 400_000; // 4,000.00 per month
    expect(runWeeklyCents(mrr)).toBeCloseTo((400_000 * 12) / 52, 10);
    expect(runWeeklyCents(mrr)).not.toBeCloseTo(mrr / 4, 2);
    expect(runWeeklyCents(mrr)).not.toBeCloseTo(mrr / 4.345, 2);
  });

  it("reads a missing mrr as nothing rather than guessing", () => {
    expect(runWeeklyCents(null)).toBe(0);
    expect(runWeeklyCents(undefined)).toBe(0);
    expect(runWeeklyCents(Number.NaN)).toBe(0);
  });

  it("rounds only at the display boundary", () => {
    expect(displayCents(runWeeklyCents(100_000))).toBe(23_077);
  });
});

describe("weeklyRevenue", () => {
  const week = weekWindow("2026-09-03T00:00:00.000Z");

  it("derives Run from tier state only", () => {
    const result = weeklyRevenue({
      week,
      clients: [
        { tier: "run", mrrCents: 260_000 },
        { tier: "run", mrrCents: null },
        { tier: "build", mrrCents: 999_999 },
        { tier: "diagnose", mrrCents: 999_999 },
        { tier: null, mrrCents: 999_999 },
      ],
    });
    expect(result.runCents).toBeCloseTo((260_000 * 12) / 52, 10);
    expect(result.diagnoseCents).toBe(0);
    expect(result.buildCents).toBe(0);
  });

  it("recognises Diagnose in full in the week the proposal was signed", () => {
    const result = weeklyRevenue({
      week,
      clients: [],
      signedProposals: [
        { occurredAt: "2026-09-02T10:00:00.000Z", amountCents: 250_000 },
        { occurredAt: "2026-08-30T10:00:00.000Z", amountCents: 999_999 },
        { occurredAt: "2026-09-02T10:00:00.000Z", amountCents: null },
      ],
    });
    expect(result.diagnoseCents).toBe(250_000);
    expect(result.totalCents).toBe(250_000);
  });

  it("recognises Build in full in the week of the tier change", () => {
    const result = weeklyRevenue({
      week,
      clients: [],
      buildPhases: [
        { occurredAt: "2026-09-04T09:00:00.000Z", phaseAmountCents: 1_200_000 },
        { occurredAt: "2026-09-14T09:00:00.000Z", phaseAmountCents: 500_000 },
      ],
    });
    expect(result.buildCents).toBe(1_200_000);
  });

  it("never lets a signed proposal inflate Run before the tier changes", () => {
    const signedOnly = weeklyRevenue({
      week,
      clients: [{ tier: "diagnose", mrrCents: 400_000 }],
      signedProposals: [{ occurredAt: "2026-09-02T10:00:00.000Z", amountCents: 250_000 }],
    });
    expect(signedOnly.runCents).toBe(0);
    expect(signedOnly.totalCents).toBe(250_000);

    const afterTierChange = weeklyRevenue({
      week,
      clients: [{ tier: "run", mrrCents: 400_000 }],
      signedProposals: [{ occurredAt: "2026-09-02T10:00:00.000Z", amountCents: 250_000 }],
    });
    expect(afterTierChange.runCents).toBeCloseTo((400_000 * 12) / 52, 10);
  });

  it("adds the three streams into one total", () => {
    const result = weeklyRevenue({
      week,
      clients: [{ tier: "run", mrrCents: 520_000 }],
      signedProposals: [{ occurredAt: "2026-09-01T10:00:00.000Z", amountCents: 300_000 }],
      buildPhases: [{ occurredAt: "2026-09-01T10:00:00.000Z", phaseAmountCents: 100_000 }],
    });
    expect(result.totalCents).toBeCloseTo(result.runCents + 400_000, 10);
    expect(displayCents(result.runCents)).toBe(120_000);
  });
});
