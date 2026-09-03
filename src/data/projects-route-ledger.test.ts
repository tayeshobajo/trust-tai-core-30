import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "@/domain/activity";
import {
  buildRouteLedger,
  canAcceptRoute,
  routeStanding,
  unansweredRoutes,
} from "@/domain/route-ledger";

const NOW = new Date("2026-08-16T00:00:00.000Z");
const KEY = "project.routed_to_ops:p1:ship-the-site";

function event(name: string, occurredAt: string, payload: Record<string, unknown>): ActivityEvent {
  return {
    id: `${name}-${occurredAt}`,
    organizationId: "org-1",
    name: name as ActivityEvent["name"],
    subject: { type: "project", id: "p1", label: "Website rebuild" },
    summary: name,
    payload,
    provenance: {
      appId: "projects",
      actor: { type: "user", id: "u1" },
      observedAt: occurredAt,
      confidence: "observed",
    },
    occurredAt,
  };
}

const requested = event("project.routed_to_ops", "2026-08-10T00:00:00.000Z", {
  source_event_key: KEY,
  project_id: "p1",
  target_app: "ops",
  requested_outcome: "Ship the marketing site",
  because: "Roadmap milestone approved",
  requested_at: "2026-08-10T00:00:00.000Z",
  evidence: [{ label: "Milestone approval", kind: "human" }],
  dependencies: ["Brand copy"],
});

describe("route ledger", () => {
  it("reads a request as requested, not accepted", () => {
    const [entry] = buildRouteLedger([requested], { now: NOW });
    expect(entry?.status).toBe("requested");
    expect(entry?.targetApp).toBe("ops");
    expect(entry?.requestedOutcome).toBe("Ship the marketing site");
    expect(entry?.evidence).toHaveLength(1);
  });

  it("flags silence beyond the threshold as unanswered", () => {
    const entries = buildRouteLedger([requested], { now: NOW });
    expect(entries[0]?.ageDays).toBe(6);
    expect(unansweredRoutes(entries)).toHaveLength(1);
    expect(routeStanding(entries[0]!)).toContain("has not answered");
  });

  it("does not flag a fresh request", () => {
    const entries = buildRouteLedger([requested], {
      now: new Date("2026-08-11T00:00:00.000Z"),
    });
    expect(entries[0]?.unanswered).toBe(false);
  });

  it("records receiving-room acceptance", () => {
    const accepted = event("ops.work_accepted", "2026-08-12T00:00:00.000Z", {
      route_event_key: KEY,
    });
    const [entry] = buildRouteLedger([requested, accepted], { now: NOW });
    expect(entry?.status).toBe("accepted");
    expect(entry?.unanswered).toBe(false);
    expect(canAcceptRoute(entry)).toBe(false);
  });

  it("refuses acceptance recorded after a withdrawal", () => {
    const withdrawn = event("project.route_withdrawn", "2026-08-11T00:00:00.000Z", {
      route_event_key: KEY,
      because: "Client paused the work",
    });
    const accepted = event("ops.work_accepted", "2026-08-13T00:00:00.000Z", {
      route_event_key: KEY,
    });
    const [entry] = buildRouteLedger([requested, withdrawn, accepted], { now: NOW });
    expect(entry?.status).toBe("withdrawn");
    expect(entry?.refusedAcceptanceAt).toBe("2026-08-13T00:00:00.000Z");
    expect(entry?.withdrawnBecause).toBe("Client paused the work");
    expect(canAcceptRoute(entry)).toBe(false);
    expect(routeStanding(entry!)).toContain("refused");
  });

  it("withdrawn routes are never reported as unanswered", () => {
    const withdrawn = event("project.route_withdrawn", "2026-08-11T00:00:00.000Z", {
      route_event_key: KEY,
      because: "No longer needed",
    });
    expect(unansweredRoutes(buildRouteLedger([requested, withdrawn], { now: NOW }))).toHaveLength(
      0,
    );
  });

  it("keeps the notification outcome honest", () => {
    const notified = event("project.route_notified", "2026-08-10T00:01:00.000Z", {
      route_event_key: KEY,
      delivered: false,
      because: "No Ops inbox is configured yet, so nobody was notified.",
    });
    const [entry] = buildRouteLedger([requested, notified], { now: NOW });
    expect(entry?.notification?.delivered).toBe(false);
    expect(entry?.notification?.because).toContain("nobody was notified");
  });

  it("ignores follow-ups that reference an unknown route", () => {
    const stray = event("ops.work_accepted", "2026-08-12T00:00:00.000Z", {
      route_event_key: "project.routed_to_ops:other:thing",
    });
    const [entry] = buildRouteLedger([requested, stray], { now: NOW });
    expect(entry?.status).toBe("requested");
  });
});
