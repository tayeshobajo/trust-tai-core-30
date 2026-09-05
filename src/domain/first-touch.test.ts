import { describe, expect, it } from "vitest";

import { countFirstTouches, isEligibleFirstTouch } from "./first-touch";
import { businessWeek } from "./business-week";

const WEEK = businessWeek("2026-09-03T18:00:00.000Z", "America/Chicago");

function touch(overrides: Partial<Parameters<typeof isEligibleFirstTouch>[0]> = {}) {
  return {
    relationshipId: "rel-1",
    channel: "email",
    direction: "outbound",
    occurredAt: "2026-09-01T15:00:00.000Z",
    loggedBy: "user-1",
    ...overrides,
  };
}

describe("first touch eligibility", () => {
  it("accepts a human outbound touch on a real outreach channel", () => {
    expect(isEligibleFirstTouch(touch())).toBe(true);
    expect(isEligibleFirstTouch(touch({ channel: "call" }))).toBe(true);
    expect(isEligibleFirstTouch(touch({ channel: "meeting" }))).toBe(true);
    expect(isEligibleFirstTouch(touch({ channel: "linkedin" }))).toBe(true);
  });

  it("refuses inbound, internal notes, unlogged arrivals and withdrawn records", () => {
    expect(isEligibleFirstTouch(touch({ direction: "inbound" }))).toBe(false);
    expect(isEligibleFirstTouch(touch({ channel: "note" }))).toBe(false);
    expect(isEligibleFirstTouch(touch({ loggedBy: null }))).toBe(false);
    expect(isEligibleFirstTouch(touch({ retracted: true }))).toBe(false);
  });
});

describe("countFirstTouches", () => {
  it("counts nothing when the only contact was inbound", () => {
    expect(countFirstTouches([touch({ direction: "inbound" })], WEEK)).toBe(0);
  });

  it("counts a first outreach even when they wrote to us first", () => {
    const touches = [
      touch({ direction: "inbound", occurredAt: "2026-08-20T15:00:00.000Z" }),
      touch({ occurredAt: "2026-09-01T15:00:00.000Z" }),
    ];
    expect(countFirstTouches(touches, WEEK)).toBe(1);
  });

  it("does not count a relationship we had already reached out to", () => {
    const touches = [
      touch({ occurredAt: "2026-08-20T15:00:00.000Z" }),
      touch({ occurredAt: "2026-09-01T15:00:00.000Z" }),
    ];
    expect(countFirstTouches(touches, WEEK)).toBe(0);
  });

  it("counts one relationship once, however many times we wrote this week", () => {
    const touches = [
      touch({ occurredAt: "2026-09-01T15:00:00.000Z" }),
      touch({ occurredAt: "2026-09-02T15:00:00.000Z", channel: "call" }),
      touch({ occurredAt: "2026-09-03T15:00:00.000Z" }),
    ];
    expect(countFirstTouches(touches, WEEK)).toBe(1);
  });

  it("counts each new relationship separately", () => {
    const touches = [
      touch({ relationshipId: "rel-1" }),
      touch({ relationshipId: "rel-2", occurredAt: "2026-09-02T15:00:00.000Z" }),
      touch({ relationshipId: "rel-3", occurredAt: "2026-08-01T15:00:00.000Z" }),
    ];
    expect(countFirstTouches(touches, WEEK)).toBe(2);
  });

  it("uses the organization week, not the UTC one", () => {
    // Monday 2026-08-31 03:00 UTC is still Sunday evening in Chicago.
    const touches = [touch({ occurredAt: "2026-08-31T03:00:00.000Z" })];
    expect(countFirstTouches(touches, WEEK)).toBe(0);
    expect(countFirstTouches(touches, businessWeek("2026-08-31T03:00:00.000Z", "UTC"))).toBe(1);
  });
});
