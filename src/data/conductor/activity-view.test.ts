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
  activityKind,
  readActivityDate,
  orderRange,
  recordedActivity,
  filterActivity,
  readActivityKind,
  readActivityQuery,
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

describe("activity search and filters", () => {
  const rows = [
    { id: "1", label: "Send the pricing note", roomLabel: "Steward", standing: "recorded", kind: activityKind("task.completed", "Tai completed the pricing note."), at: null },
    { id: "2", label: "Draft intro", roomLabel: "Steward", standing: "recorded", kind: activityKind("task.assigned", "Draft intro now carried by Ana."), at: null },
    { id: "3", label: "Kickoff", roomLabel: "Steward", standing: "recorded", kind: activityKind("task.updated", "Moved above Kickoff."), at: null },
  ];

  it("names completion, reassignment and reordering from what was recorded", () => {
    expect(rows.map((row) => row.kind)).toEqual(["completed", "reassigned", "reordered"]);
  });

  it("keeps only the chosen kind", () => {
    expect(filterActivity(rows, { kind: "reassigned" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterActivity(rows, { kind: "all" })).toHaveLength(3);
  });

  it("searches label, room and standing, case insensitively", () => {
    expect(filterActivity(rows, { query: "pricing" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterActivity(rows, { query: "steward" })).toHaveLength(3);
    expect(filterActivity(rows, { query: "nothing here" })).toHaveLength(0);
  });

  it("reads params defensively", () => {
    expect(readActivityKind({ kind: "completed" })).toBe("completed");
    expect(readActivityKind({ kind: "banana" })).toBe("all");
    expect(readActivityQuery({ q: 5 })).toBe("");
  });
});


describe("activity date window", () => {
  const rows = [
    { id: "1", label: "a", roomLabel: "Steward", standing: "recorded", kind: "other" as const, at: "2026-08-10T09:00:00.000Z" },
    { id: "2", label: "b", roomLabel: "Steward", standing: "recorded", kind: "other" as const, at: "2026-08-14T09:00:00.000Z" },
    { id: "3", label: "c", roomLabel: "Steward", standing: "recorded", kind: "other" as const, at: null },
  ];

  it("keeps only what falls inside the window, inclusively", () => {
    const day = (at: string) => new Date(at).toISOString().slice(0, 10);
    const from = day(rows[0]!.at!);
    const to = day(rows[1]!.at!);
    expect(filterActivity(rows, { range: { from, to } }).map((row) => row.id)).toEqual(["1", "2"]);
    expect(filterActivity(rows, { range: { from: to, to: "" } }).map((row) => row.id)).toEqual(["2"]);
  });

  it("leaves undated rows out of a window, and in when there is none", () => {
    expect(filterActivity(rows, { range: { from: "2026-01-01", to: "" } }).map((r) => r.id)).not.toContain("3");
    expect(filterActivity(rows, {})).toHaveLength(3);
  });

  it("reads dates defensively and repairs a back-to-front window", () => {
    expect(readActivityDate({ from: "2026-08-10" }, "from")).toBe("2026-08-10");
    expect(readActivityDate({ from: "last tuesday" }, "from")).toBe("");
    expect(orderRange({ from: "2026-08-14", to: "2026-08-10" })).toEqual({
      from: "2026-08-10",
      to: "2026-08-14",
    });
  });
});

describe("activity rows point back at the task", () => {
  it("carries the task key and title when the event is about a task", () => {
    const [row] = recordedActivity([
      {
        id: "e1",
        organizationId: "org",
        name: "task.completed",
        subject: { type: "task", id: "t1", label: "Send the pricing note" },
        summary: "Tai completed it.",
        payload: { steward_task_key: "task:t1" },
        provenance: { appId: "steward", actor: { type: "user", id: "u1" }, observedAt: "2026-08-14T09:00:00.000Z" },
        occurredAt: "2026-08-14T09:00:00.000Z",
      },
    ]);
    expect(row?.task).toEqual({ key: "task:t1", id: "t1", title: "Send the pricing note" });
  });

  it("leaves the task off when the event is about something else", () => {
    const [row] = recordedActivity([
      {
        id: "e2",
        organizationId: "org",
        name: "project.updated",
        subject: { type: "project", id: "p1", label: "Northlight" },
        summary: "Moved to in progress.",
        provenance: { appId: "projects", actor: { type: "user", id: "u1" }, observedAt: "2026-08-14T09:00:00.000Z" },
        occurredAt: "2026-08-14T09:00:00.000Z",
      },
    ]);
    expect(row?.task).toBeUndefined();
  });
});
