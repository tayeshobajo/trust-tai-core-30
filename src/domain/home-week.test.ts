import { describe, expect, it } from "vitest";

import {
  HOME_NUMBER_ORDER,
  hasUnreadableNumber,
  homeFloorReadings,
  homeWeekNote,
  homeWeekNumbers,
  type HomeWeekInput,
} from "./home-week";
import { DEFAULT_WEEKLY_TARGETS } from "./weekly-targets";
import { floorBreaches, orderToday, type TodayCandidate } from "./today-ordering";

function input(over: Partial<HomeWeekInput> = {}): HomeWeekInput {
  return {
    targets: { ...DEFAULT_WEEKLY_TARGETS, revenueTargetCents: 2_100_000 },
    revenue: { totalCents: 2_100_000 },
    firstTouches: 11,
    discoveryCalls: 2,
    proposalsSent: 1,
    timeZone: "America/Chicago",
    timeZoneFallback: false,
    ...over,
  };
}

describe("the four canonical Home numbers", () => {
  it("are exactly four, in charter order", () => {
    const numbers = homeWeekNumbers(input());
    expect(numbers.map((n) => n.key)).toEqual(HOME_NUMBER_ORDER);
    expect(numbers).toHaveLength(4);
  });

  it("reads a good week as on pace", () => {
    const numbers = homeWeekNumbers(input());
    expect(numbers.map((n) => n.state)).toEqual([
      "on_pace",
      "on_pace",
      "on_pace",
      "on_pace",
    ]);
    expect(numbers[0]?.display).toBe("$21,000");
    expect(numbers[1]?.targetLabel).toBe("Target 10 to 12");
  });

  it("marks a count below the agreed low end as a floor breach", () => {
    const numbers = homeWeekNumbers(input({ firstTouches: 3 }));
    expect(numbers[1]?.state).toBe("below_floor");
  });

  it("marks a count above the agreed high end as ahead", () => {
    const numbers = homeWeekNumbers(input({ discoveryCalls: 9 }));
    expect(numbers[2]?.state).toBe("ahead");
  });

  it("shows revenue against its goal, and never as a floor when no goal exists", () => {
    const numbers = homeWeekNumbers(
      input({ targets: { ...DEFAULT_WEEKLY_TARGETS, revenueTargetCents: null } }),
    );
    expect(numbers[0]?.state).toBe("no_target");
    expect(numbers[0]?.targetLabel).toBeNull();
  });
});

describe("unknown is not zero", () => {
  it("reports an unreadable source as unknown with a reason", () => {
    const numbers = homeWeekNumbers(input({ firstTouches: null }), {
      firstTouches: "Comms touches could not be read.",
    });
    expect(numbers[1]?.value).toBeNull();
    expect(numbers[1]?.display).toBe("Unknown");
    expect(numbers[1]?.state).toBe("unknown");
    expect(numbers[1]?.because).toBe("Comms touches could not be read.");
    expect(hasUnreadableNumber(numbers)).toBe(true);
  });

  it("keeps an empty source as a real zero, distinct from unknown", () => {
    const numbers = homeWeekNumbers(input({ discoveryCalls: 0 }));
    expect(numbers[2]?.value).toBe(0);
    expect(numbers[2]?.display).toBe("0");
    expect(numbers[2]?.state).toBe("below_floor");
    expect(hasUnreadableNumber(numbers)).toBe(false);
  });

  it("never turns unreadable revenue into $0", () => {
    const numbers = homeWeekNumbers(input({ revenue: null }), { revenue: "Clients unreadable." });
    expect(numbers[0]?.display).toBe("Unknown");
    expect(numbers[0]?.value).toBeNull();
  });

  it("gives every number a legitimate next action and an owning room", () => {
    for (const number of homeWeekNumbers(input({ revenue: null, firstTouches: null }))) {
      expect(number.action.length).toBeGreaterThan(0);
      expect(["clients", "comms"]).toContain(number.slug);
    }
  });
});

describe("floor readings feeding Today", () => {
  it("only offers the three ranged counting targets", () => {
    expect(homeFloorReadings(input()).map((r) => r.key)).toEqual([
      "floor-first-touches",
      "floor-discovery-calls",
      "floor-proposals-sent",
    ]);
  });

  it("drops an unreadable source rather than calling it a breach", () => {
    const readings = homeFloorReadings(input({ discoveryCalls: null }));
    expect(readings.map((r) => r.key)).not.toContain("floor-discovery-calls");
    expect(floorBreaches(readings)).toEqual([]);
  });

  it("counts the shortfall when the week is under the floor", () => {
    const breaches = floorBreaches(homeFloorReadings(input({ firstTouches: 4 })));
    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.count).toBe(6);
    expect(breaches[0]?.kind).toBe("floor_breach");
  });
});

describe("Today keeps the charter order with real Home inputs", () => {
  it("puts an obligation at risk above a floor breach above a decision", () => {
    const candidates: TodayCandidate[] = [
      { key: "decisions", kind: "decision_opportunity", count: 9, label: "d", slug: "approvals" },
      ...floorBreaches(homeFloorReadings(input({ firstTouches: 0 }))),
      { key: "blocked", kind: "obligation_at_risk", count: 1, label: "b", slug: "projects" },
    ];
    expect(orderToday(candidates).map((c) => c.kind)).toEqual([
      "obligation_at_risk",
      "floor_breach",
      "decision_opportunity",
    ]);
  });
});

describe("the week belongs to the organization", () => {
  it("names the organization timezone", () => {
    expect(homeWeekNote(input())).toContain("America/Chicago");
  });

  it("says so when the timezone had to fall back", () => {
    expect(
      homeWeekNote(
        input({ timeZone: "UTC", timeZoneFallback: true, timeZoneBecause: "No timezone set." }),
      ),
    ).toBe("No timezone set.");
  });
});
