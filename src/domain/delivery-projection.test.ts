import { describe, expect, it } from "vitest";

import type { AcceptanceCriterion } from "./milestone-criteria";
import type { RoadmapMilestone } from "./roadmap-intel";
import {
  CRITERIA_UNREADABLE,
  NO_CARRIER,
  NO_CONDITIONS,
  deliveryProjection,
  shortTargetDate,
} from "./delivery-projection";

const NOW = "2026-01-01T00:00:00.000Z";

function milestone(overrides: Partial<RoadmapMilestone> = {}): RoadmapMilestone {
  return {
    id: "m1",
    organizationId: "org",
    roadmapId: "r1",
    name: "Booking engine",
    whatWeBuild: "A booking engine",
    intendedUser: "",
    supportingMarketDirection: "",
    clientAdvantage: "",
    currentGap: "",
    evidence: [],
    immediateValue: "",
    longTermValue: "",
    dependencies: [],
    executionBoundary: "",
    confidence: "moderate",
    priorityScore: 50,
    priorityRationale: [],
    recommendedSequence: 1,
    status: "approved",
    tier: "decided",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as RoadmapMilestone;
}

function criterion(overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {
    id: "c1",
    organizationId: "org",
    roadmapId: "r1",
    milestoneId: "m1",
    text: "Home page approved",
    position: 1,
    done: false,
    createdBy: "u1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const carrier = { name: "Mental Dental Academy", state: "in_flight" as const };

describe("deliveryProjection", () => {
  it("reads state, carrier, conditions and target date in one line", () => {
    const read = deliveryProjection({
      milestone: milestone({
        success: {
          outcome: "Bookings live",
          targetDate: "2026-09-11",
          successCheck: null,
          tier: "decided",
          recordedBy: "u1",
          recordedAt: NOW,
        },
      }),
      project: carrier,
      criteria: [criterion()],
    });
    expect(read.line).toBe(
      "In flight · Mental Dental Academy · 0 of 1 acceptance condition met · target Sep 11",
    );
    expect(read.missing).toBeNull();
    expect(read.unowned).toBe(false);
  });

  it("omits the target date when nobody recorded one, and says it can be", () => {
    const read = deliveryProjection({ milestone: milestone(), project: carrier, criteria: [] });
    expect(read.line).not.toMatch(/target/);
    expect(read.missing).toBe("target-date");
  });

  it("keeps no conditions and unreadable conditions apart, and never shows zero", () => {
    expect(
      deliveryProjection({ milestone: milestone(), project: carrier, criteria: [] }).segments,
    ).toContain(NO_CONDITIONS);

    const unreadable = deliveryProjection({
      milestone: milestone(),
      project: carrier,
      criteria: null,
    });
    expect(unreadable.segments).toContain(CRITERIA_UNREADABLE);
    expect(unreadable.line).not.toMatch(/0 of/);
  });

  it("counts only this milestone's conditions", () => {
    const read = deliveryProjection({
      milestone: milestone(),
      project: carrier,
      criteria: [
        criterion({ id: "a", done: true }),
        criterion({ id: "b" }),
        criterion({ id: "other", milestoneId: "m2", done: true }),
      ],
    });
    expect(read.line).toContain("1 of 2 acceptance conditions met");
  });

  it("names a closed or delivered project honestly rather than as movement", () => {
    expect(
      deliveryProjection({
        milestone: milestone(),
        project: { name: "Academy", state: "delivered" },
        criteria: [],
      }).segments[0],
    ).toBe("Delivered");
    expect(
      deliveryProjection({
        milestone: milestone(),
        project: { name: "Academy", state: "closed" },
        criteria: [],
      }).segments[0],
    ).toBe("Closed");
  });

  it("says plainly when no project carries the work", () => {
    const read = deliveryProjection({ milestone: milestone(), project: null, criteria: [] });
    expect(read.segments[0]).toBe(NO_CARRIER);
    expect(read.unowned).toBe(true);
  });
});

describe("shortTargetDate", () => {
  it("shortens a real calendar date and refuses anything else", () => {
    expect(shortTargetDate("2026-09-11")).toBe("Sep 11");
    expect(shortTargetDate("2026-13-01")).toBeNull();
    expect(shortTargetDate(null)).toBeNull();
    expect(shortTargetDate("soon")).toBeNull();
  });
});
