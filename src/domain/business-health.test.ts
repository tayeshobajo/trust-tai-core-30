import { describe, expect, it } from "vitest";

import {
  NO_OWNER,
  growthSuggestion,
  marginReading,
  measured,
  stalledWork,
  unavailable,
  unavailableMetrics,
  type HealthMetric,
} from "./business-health";

const metric = (id: string, reading: HealthMetric["reading"]): HealthMetric => ({
  id,
  label: id,
  question: "?",
  reading,
  unit: "count",
  source: "test",
  period: "now",
  readAt: null,
  drilldownHref: "/modules/clients",
  drilldownLabel: "Clients",
  target: null,
});

describe("margin", () => {
  it("is unknown when no cost is recorded, never zero cost", () => {
    const reading = marginReading({ revenueCents: 500_00, costCents: null });
    expect(reading.state).toBe("unavailable");
    if (reading.state === "unavailable") expect(reading.because).toContain("not zero cost");
  });

  it("measures against recorded revenue when cost exists", () => {
    const reading = marginReading({ revenueCents: 500_00, costCents: 200_00 });
    expect(reading).toEqual({
      state: "measured",
      value: 300_00,
      denominator: { value: 500_00, label: "recorded revenue" },
    });
  });

  it("cannot be measured without revenue", () => {
    expect(marginReading({ revenueCents: null, costCents: 10 }).state).toBe("unavailable");
  });
});

describe("unavailable is not zero", () => {
  it("lists only the metrics that could not be read", () => {
    const metrics = [metric("a", measured(0)), metric("b", unavailable("no source"))];
    expect(unavailableMetrics(metrics).map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("stalled work", () => {
  const now = new Date("2026-09-16T00:00:00.000Z");

  it("surfaces a named owner and a practical next action", () => {
    const [item] = stalledWork({
      now,
      candidates: [
        {
          id: "p1",
          label: "Acme roadmap",
          href: "/modules/projects/p1",
          owner: "Sam",
          lastMovedAt: "2026-08-01T00:00:00.000Z",
          stallAfterDays: 14,
          nextAction: "Send the revised phase dates.",
          weOweAReply: false,
        },
      ],
    });
    expect(item).toMatchObject({ owner: "Sam", nextAction: "Send the revised phase dates.", days: 46 });
  });

  it("names the missing owner rather than hiding the exception", () => {
    const [item] = stalledWork({
      now,
      candidates: [
        {
          id: "p2",
          label: "Unowned",
          href: "/modules/projects/p2",
          owner: null,
          lastMovedAt: "2026-08-01T00:00:00.000Z",
          stallAfterDays: 7,
          nextAction: "Assign this work.",
          weOweAReply: false,
        },
      ],
    });
    expect(item?.owner).toBe(NO_OWNER);
    expect(item?.ownerMissing).toBe(true);
  });

  it("does not turn a quiet client into stalled work when nothing is owed", () => {
    expect(
      stalledWork({
        now,
        candidates: [
          {
            id: "c1",
            label: "Quiet client",
            href: "/modules/clients/c1",
            owner: "Sam",
            lastMovedAt: "2026-06-01T00:00:00.000Z",
            stallAfterDays: 14,
            nextAction: null,
            weOweAReply: false,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("does surface work where we owe the reply", () => {
    const items = stalledWork({
      now,
      candidates: [
        {
          id: "c2",
          label: "Reply owed",
          href: "/modules/clients/c2",
          owner: null,
          lastMovedAt: "2026-08-20T00:00:00.000Z",
          stallAfterDays: 7,
          nextAction: null,
          weOweAReply: true,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.nextAction).toContain("Reply to the client");
  });

  it("ignores work with no recorded movement instead of guessing an age", () => {
    expect(
      stalledWork({
        now,
        candidates: [
          {
            id: "c3",
            label: "Unknown age",
            href: "/modules/clients/c3",
            owner: "Sam",
            lastMovedAt: null,
            stallAfterDays: 1,
            nextAction: "Do something.",
            weOweAReply: true,
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("growth suggestions", () => {
  it("is suppressed while a complaint is unresolved", () => {
    const suggestion = growthSuggestion({
      clientId: "c1",
      evidence: [{ label: "Outcome review", href: "/modules/clients/c1" }],
      unresolvedComplaints: 1,
    });
    expect(suggestion.allowed).toBe(false);
    expect(suggestion.because).toContain("unresolved complaint");
  });

  it("needs a recorded outcome behind it", () => {
    expect(
      growthSuggestion({ clientId: "c1", evidence: [], unresolvedComplaints: 0 }).allowed,
    ).toBe(false);
  });

  it("carries its evidence when it is allowed", () => {
    const suggestion = growthSuggestion({
      clientId: "c1",
      evidence: [{ label: "Outcome review", href: "/modules/clients/c1" }],
      unresolvedComplaints: 0,
    });
    expect(suggestion.allowed).toBe(true);
    if (suggestion.allowed) expect(suggestion.evidence).toHaveLength(1);
  });
});
