import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEEKLY_TARGETS,
  assertWeeklyTargets,
  readWeeklyTargets,
  validateWeeklyTargets,
  type WeeklyTargets,
} from "./weekly-targets";

const VALID: WeeklyTargets = {
  firstTouchTargetLow: 10,
  firstTouchTargetHigh: 12,
  discoveryTargetLow: 2,
  discoveryTargetHigh: 3,
  diagnoseProposalsTargetLow: 1,
  diagnoseProposalsTargetHigh: 2,
  runClientsTarget: 20,
  revenueTargetCents: 2_100_000,
};

describe("validateWeeklyTargets", () => {
  it("accepts the locked defaults and a real Trust Tai week", () => {
    expect(validateWeeklyTargets(DEFAULT_WEEKLY_TARGETS)).toEqual([]);
    expect(validateWeeklyTargets(VALID)).toEqual([]);
    expect(() => assertWeeklyTargets(VALID)).not.toThrow();
  });

  it("refuses a low above its high", () => {
    expect(validateWeeklyTargets({ ...VALID, firstTouchTargetLow: 20 })).toContain(
      "First touches: the lower target cannot be above the higher one.",
    );
  });

  it("refuses negative counts", () => {
    expect(validateWeeklyTargets({ ...VALID, runClientsTarget: -3 })).toContain(
      "Run clients cannot be negative.",
    );
  });

  it("refuses counts that are not whole numbers, even when the types were bypassed", () => {
    const sneaky = { ...VALID, discoveryTargetLow: 1.5 } as WeeklyTargets;
    expect(validateWeeklyTargets(sneaky)).toContain("Discovery calls (low) must be a whole number.");
    const notANumber = { ...VALID, runClientsTarget: "twenty" } as unknown as WeeklyTargets;
    expect(validateWeeklyTargets(notANumber)).toContain("Run clients must be a whole number.");
    const nan = { ...VALID, firstTouchTargetHigh: Number.NaN } as WeeklyTargets;
    expect(validateWeeklyTargets(nan)).toContain("First touches (high) must be a whole number.");
  });

  it("allows no revenue goal, but not a broken one", () => {
    expect(validateWeeklyTargets({ ...VALID, revenueTargetCents: null })).toEqual([]);
    expect(validateWeeklyTargets({ ...VALID, revenueTargetCents: -1 })).toContain(
      "The revenue target cannot be negative.",
    );
    expect(validateWeeklyTargets({ ...VALID, revenueTargetCents: 10.5 })).toContain(
      "The revenue target must be a whole number of cents.",
    );
  });

  it("reports everything wrong at once, so it can be fixed in one pass", () => {
    const problems = validateWeeklyTargets({
      ...VALID,
      runClientsTarget: -1,
      discoveryTargetLow: 9,
    });
    expect(problems).toHaveLength(2);
    expect(() => assertWeeklyTargets({ ...VALID, runClientsTarget: -1 })).toThrow(/negative/i);
  });

  it("still reads a stored row with the defaults behind it", () => {
    expect(readWeeklyTargets(null)).toEqual(DEFAULT_WEEKLY_TARGETS);
    expect(validateWeeklyTargets(readWeeklyTargets({ run_clients_target: 24 }))).toEqual([]);
  });
});
