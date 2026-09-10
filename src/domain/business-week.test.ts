import { describe, expect, it } from "vitest";

import {
  CANONICAL_FALLBACK_TIME_ZONE,
  businessWeek,
  isValidTimeZone,
  resolveBusinessTimeZone,
} from "./business-week";

describe("businessWeek in America/Chicago", () => {
  it("starts on local Monday 00:00, expressed in UTC", () => {
    // A Thursday afternoon in Chicago, CDT (UTC-5).
    const week = businessWeek("2026-09-03T18:00:00.000Z", "America/Chicago");
    expect(week.start).toBe("2026-08-31T05:00:00.000Z");
    expect(week.end).toBe("2026-09-07T05:00:00.000Z");
  });

  it("puts local Sunday night in the week that began six days earlier", () => {
    // 2026-09-06 23:30 in Chicago is 2026-09-07 04:30 UTC: still last week locally.
    const week = businessWeek("2026-09-07T04:30:00.000Z", "America/Chicago");
    expect(week.start).toBe("2026-08-31T05:00:00.000Z");
  });

  it("disagrees with UTC for instants in the local Monday small hours", () => {
    // 2026-08-31 02:00 UTC is still Sunday evening in Chicago.
    const chicago = businessWeek("2026-08-31T02:00:00.000Z", "America/Chicago");
    const utc = businessWeek("2026-08-31T02:00:00.000Z", "UTC");
    expect(utc.start).toBe("2026-08-31T00:00:00.000Z");
    expect(chicago.start).toBe("2026-08-24T05:00:00.000Z");
  });

  it("holds through the spring-forward week, which is 167 hours long", () => {
    // US DST began Sunday 2026-03-08.
    const week = businessWeek("2026-03-04T12:00:00.000Z", "America/Chicago");
    expect(week.start).toBe("2026-03-02T06:00:00.000Z"); // CST, UTC-6
    expect(week.end).toBe("2026-03-09T05:00:00.000Z"); // CDT, UTC-5
    const hours = (Date.parse(week.end) - Date.parse(week.start)) / 3_600_000;
    expect(hours).toBe(167);
  });

  it("holds through the fall-back week, which is 169 hours long", () => {
    // US DST ended Sunday 2026-11-01.
    const week = businessWeek("2026-10-28T12:00:00.000Z", "America/Chicago");
    expect(week.start).toBe("2026-10-26T05:00:00.000Z"); // CDT, UTC-5
    expect(week.end).toBe("2026-11-02T06:00:00.000Z"); // CST, UTC-6
    const hours = (Date.parse(week.end) - Date.parse(week.start)) / 3_600_000;
    expect(hours).toBe(169);
  });

  it("gives the same answer whatever the machine's own timezone is", () => {
    const first = businessWeek("2026-09-03T18:00:00.000Z", "America/Chicago");
    const second = businessWeek(new Date("2026-09-03T18:00:00.000Z"), "America/Chicago");
    const third = businessWeek(Date.parse("2026-09-03T18:00:00.000Z"), "America/Chicago");
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("refuses a timezone it does not recognise rather than guessing", () => {
    expect(() => businessWeek("2026-09-03T18:00:00.000Z", "Mars/Olympus")).toThrow(/timezone/i);
    expect(() => businessWeek("not a date", "America/Chicago")).toThrow(/real date/i);
  });
});

describe("resolveBusinessTimeZone", () => {
  it("keeps a real organization timezone", () => {
    expect(resolveBusinessTimeZone("America/Chicago")).toEqual({
      timeZone: "America/Chicago",
      fallback: false,
    });
  });

  it("reports the fallback out loud instead of using the server's timezone", () => {
    const missing = resolveBusinessTimeZone(null);
    expect(missing.timeZone).toBe(CANONICAL_FALLBACK_TIME_ZONE);
    expect(missing.fallback).toBe(true);
    expect(missing.because).toMatch(/no timezone set/i);

    const nonsense = resolveBusinessTimeZone("Mars/Olympus");
    expect(nonsense.fallback).toBe(true);
    expect(nonsense.because).toMatch(/not a timezone/i);
  });

  it("knows a valid zone from an invalid one", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(7)).toBe(false);
  });
});
