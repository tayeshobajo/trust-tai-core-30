import { describe, expect, it } from "vitest";

import { countDiscoveryCalls, countRoadmapReviews } from "./discovery";
import { weekWindow } from "./revenue";

const now = "2026-09-04T12:00:00.000Z";
const week = weekWindow(now);

describe("countDiscoveryCalls", () => {
  it("counts only meetings a person marked as discovery", () => {
    expect(
      countDiscoveryCalls(
        [
          { meetingKind: "discovery", occurredAt: "2026-09-02T10:00:00.000Z" },
          { meetingKind: "roadmap_review", occurredAt: "2026-09-02T11:00:00.000Z" },
          { meetingKind: "delivery", occurredAt: "2026-09-02T12:00:00.000Z" },
          { meetingKind: null, occurredAt: "2026-09-02T13:00:00.000Z" },
        ],
        { now, week },
      ),
    ).toBe(1);
  });

  it("does not count a meeting that has not happened yet", () => {
    expect(
      countDiscoveryCalls(
        [{ meetingKind: "discovery", occurredAt: "2026-09-05T10:00:00.000Z" }],
        { now, week },
      ),
    ).toBe(0);
  });

  it("ignores a withdrawn record", () => {
    expect(
      countDiscoveryCalls(
        [{ meetingKind: "discovery", occurredAt: "2026-09-02T10:00:00.000Z", retracted: true }],
        { now, week },
      ),
    ).toBe(0);
  });

  it("respects the week window when one is given", () => {
    const touches = [
      { meetingKind: "discovery" as const, occurredAt: "2026-08-27T10:00:00.000Z" },
      { meetingKind: "discovery" as const, occurredAt: "2026-09-02T10:00:00.000Z" },
    ];
    expect(countDiscoveryCalls(touches, { now, week })).toBe(1);
    expect(countDiscoveryCalls(touches, { now })).toBe(2);
  });
});

describe("countRoadmapReviews", () => {
  it("is a separate count from discovery", () => {
    const touches = [
      { meetingKind: "roadmap_review" as const, occurredAt: "2026-09-01T10:00:00.000Z" },
      { meetingKind: "discovery" as const, occurredAt: "2026-09-01T11:00:00.000Z" },
    ];
    expect(countRoadmapReviews(touches, { now, week })).toBe(1);
    expect(countDiscoveryCalls(touches, { now, week })).toBe(1);
  });
});
