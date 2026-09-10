import { describe, expect, it } from "vitest";

import { answered, unreadable, type ReviewCadence } from "./client-shell";
import { attentionItems, overviewSignals, type OverviewComposeInput } from "./client-overview";
import type { ExecutionProject } from "./projects";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const ZONE = "UTC";

const CADENCE: ReviewCadence = {
  state: "booked",
  line: "Next review Sep 19",
  renewalLine: "Renews Oct 3",
};

function project(patch: Partial<ExecutionProject>): ExecutionProject {
  return {
    id: "p1",
    organizationId: "org",
    clientId: "c1",
    name: "Mental Dental Academy",
    state: "in_flight",
    lastMovedAt: "2026-09-01T00:00:00.000Z",
    currentWork: null,
    nextMove: null,
    pointB: null,
    blockedBecause: null,
    ...patch,
  } as ExecutionProject;
}

function input(patch: Partial<OverviewComposeInput> = {}): OverviewComposeInput {
  return {
    projects: null,
    relationship: null,
    roadmap: null,
    approvals: null,
    exchange: null,
    cadence: CADENCE,
    commercialLine: "Run · $3,500/mo",
    now: NOW,
    timeZone: ZONE,
    ...patch,
  };
}

describe("overviewSignals", () => {
  it("keeps the four signals in the operator's order", () => {
    expect(overviewSignals(input()).map((signal) => signal.key)).toEqual([
      "delivery",
      "relationship",
      "direction",
      "commercial",
    ]);
  });

  it("names an unreadable room instead of showing it as empty", () => {
    const [delivery] = overviewSignals(input({ projects: unreadable("The read failed.") }));
    expect(delivery?.line).toBe("Could not be read");
    expect(delivery?.tone).toBe("unknown");
  });

  it("puts blocked delivery first and marks it for attention", () => {
    const [delivery] = overviewSignals(
      input({
        projects: answered([
          project({ id: "a", name: "Site" }),
          project({
            id: "b",
            name: "Academy",
            state: "blocked",
            blockedBecause: "Waiting on copy",
          }),
        ]),
      }),
    );
    expect(delivery?.line).toBe("Academy · blocked");
    expect(delivery?.note).toBe("Waiting on copy");
    expect(delivery?.tone).toBe("attention");
  });

  it("states the absence of delivery work plainly", () => {
    const [delivery] = overviewSignals(input({ projects: answered([]) }));
    expect(delivery?.line).toBe("No delivery work recorded");
  });

  it("shows commercial truth with the recorded cadence", () => {
    const signals = overviewSignals(input());
    const commercial = signals.find((signal) => signal.key === "commercial");
    expect(commercial?.line).toBe("Run · $3,500/mo");
    expect(commercial?.note).toBe("Next review Sep 19");
    expect(commercial?.tone).toBe("calm");
  });

  it("marks an overdue review for attention", () => {
    const signals = overviewSignals(
      input({
        cadence: {
          state: "overdue",
          line: "Review overdue since Aug 20",
          renewalLine: "Renews Oct 3",
        },
      }),
    );
    expect(signals.find((signal) => signal.key === "commercial")?.tone).toBe("attention");
  });
});

describe("attentionItems", () => {
  it("stays empty when nothing is actually owed", () => {
    expect(attentionItems(input({ projects: answered([]), roadmap: answered(null) }))).toEqual([]);
  });

  it("raises a blocked project with the reason recorded by Projects", () => {
    const items = attentionItems(
      input({
        projects: answered([
          project({
            id: "b",
            name: "Academy",
            state: "blocked",
            blockedBecause: "Waiting on copy",
          }),
        ]),
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.line).toBe("Academy is blocked");
    expect(items[0]?.because).toBe("Waiting on copy");
  });

  it("raises an overdue review", () => {
    const items = attentionItems(
      input({
        cadence: {
          state: "overdue",
          line: "Review overdue since Aug 20",
          renewalLine: "Renews Oct 3",
        },
      }),
    );
    expect(items[0]?.line).toBe("Review overdue since Aug 20");
  });

  it("does not repeat a person who is already listed as past due", () => {
    const items = attentionItems(
      input({
        relationship: answered({
          people: [
            {
              id: "r1",
              fullName: "Dr. Ryan Gross",
              stageLabel: "Client",
              lastTouchAt: "2026-09-05T00:00:00.000Z",
              nextAction: null,
              overdue: true,
            },
          ],
          lead: null,
          lastTouchAt: "2026-09-05T00:00:00.000Z",
          overdue: 1,
        }),
        exchange: {
          owed: 1,
          people: [
            {
              relationshipId: "r1",
              fullName: "Dr. Ryan Gross",
              threadCount: 1,
              messageCount: 49,
              inboundCount: 21,
              outboundCount: 28,
              latestInbound: null,
              latestOutbound: null,
              obligation: { action: "Reply", whyNow: "They wrote last", urgency: "now" },
            },
          ],
        },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe("person-r1");
  });
});
