import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "@/domain/activity";
import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";

import {
  awaitingJudgment,
  movements,
  readActivityView,
  todaysActivity,
  ACTIVITY_PAGE_SIZE,
  pageActivity,
  readActivityPage,
} from "./activity-view";

function event(id: string, occurredAt: string): ActivityEvent {
  return {
    id,
    organizationId: "org",
    name: "prospect.qualified" as ActivityEvent["name"],
    subject: { type: "prospect", id: `p-${id}`, label: `Prospect ${id}` },
    summary: `Summary ${id}`,
    payload: {},
    provenance: {
      appId: "scout",
      actor: { type: "user", id: "u1" },
      observedAt: occurredAt,
      confidence: "observed",
    },
    occurredAt,
  } as ActivityEvent;
}

function action(overrides: Partial<ControlledAction>): ControlledAction {
  return {
    id: "a1",
    organizationId: "org",
    intent: "Route Northlight to Comms",
    owningApp: "comms",
    route: "/modules/comms",
    status: "proposed",
    requiresApproval: true,
    createdAt: "2026-08-18T09:00:00.000Z",
    ...overrides,
  } as ControlledAction;
}

describe("activity view", () => {
  it("falls back to Today for an unknown view", () => {
    expect(readActivityView({ view: "nonsense" })).toBe("today");
    expect(readActivityView({})).toBe("today");
    expect(readActivityView({ view: "moved" })).toBe("moved");
  });

  it("keeps only events from the reader's own day, newest first", () => {
    const now = new Date("2026-08-18T15:00:00.000Z");
    const rows = todaysActivity(
      [
        event("old", "2026-08-11T10:00:00.000Z"),
        event("early", new Date("2026-08-18T08:00:00.000Z").toISOString()),
        event("late", new Date("2026-08-18T14:00:00.000Z").toISOString()),
      ],
      now,
    );
    expect(rows.map((row) => row.id)).toEqual(["late", "early"]);
    expect(rows[0]?.roomLabel).toBeTruthy();
  });

  it("lists only bounded steps still waiting on a person", () => {
    const rows = awaitingJudgment([
      action({ id: "waiting" }),
      action({ id: "approved", status: "approved" }),
      action({ id: "automatic", requiresApproval: false }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["waiting"]);
    expect(rows[0]?.standing).toBe("awaiting your authorisation");
  });

  it("shows every movement, refusals included", () => {
    const receipts = [
      {
        id: "r1",
        actionId: "a1",
        owningApp: "comms",
        status: "routed",
        routedAt: "2026-08-18T10:00:00.000Z",
        boundaryCrossed: "conductor→comms",
      },
      {
        id: "r2",
        actionId: "a1",
        owningApp: "comms",
        status: "refused",
        routedAt: "2026-08-18T11:00:00.000Z",
        boundaryCrossed: "conductor→comms",
      },
    ] as ExecutionReceipt[];

    const rows = movements({ receipts, actions: [action({})] });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.standing)).toEqual(["refused", "handed over"]);
  });
});

describe("activity paging", () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    id: String(index),
    label: `row ${index}`,
    roomLabel: "Scout",
    standing: "recorded",
    kind: "other" as const,
    at: null,
  }));

  it("shows the first page and reports what remains", () => {
    const page = pageActivity(rows, 1);
    expect(page.rows).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(60);
  });

  it("grows cumulatively so a shared URL restores the same list", () => {
    expect(pageActivity(rows, 3).rows).toHaveLength(60);
    expect(pageActivity(rows, 3).hasMore).toBe(false);
  });

  it("clamps out-of-range and unreadable page params", () => {
    expect(pageActivity(rows, 99).page).toBe(3);
    expect(readActivityPage({ page: "2" })).toBe(2);
    expect(readActivityPage({ page: "banana" })).toBe(1);
    expect(readActivityPage({})).toBe(1);
  });
});
