import { describe, expect, it } from "vitest";

import {
  ROUTE_EVENT_KEY,
  RECEIVER_EVENT_KEYS,
  buildRouteRequest,
  routeMetadata,
  routeSourceEventKey,
  routeSummary,
} from "@/domain/project-routing";
import { SUITE_EVENTS, mayEmit } from "@/domain/events";
import { can, type AccessContext } from "@/domain/access";
import type { ExecutionProject } from "@/domain/projects";

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "prj-1",
    organizationId: "org-1",
    name: "Booking flow",
    state: "in_flight",
    clientId: "client-9",
    ownerUserId: "user-1",
    ownerLabel: "Tai",
    pointA: "Every booking goes through email today.",
    pointB: "A self-serve booking flow on the marketing site.",
    nextMove: "Ship the availability calendar.",
    evidence: [{ label: "Pricing page", kind: "page", url: "https://example.com/pricing" }],
    dependencies: ["Stripe account", ""],
    executionBoundary: "No payment processing in v1.",
    origin: {
      kind: "roadmap_milestone",
      roadmapId: "road-3",
      milestoneId: "mile-7",
      subjectLabel: "Northwind",
    },
    lastMovedAt: "2026-08-10T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

const intent = {
  targetApp: "ops" as const,
  requestedOutcome: "Move the booking subdomain onto monitored hosting.",
  because: "Delivery is blocked on hosting Ops already runs.",
  requestedBy: { userId: "user-1", label: "Tai" },
  requestedAt: "2026-08-16T00:00:00.000Z",
};

describe("Projects → Ops / Studio routing", () => {
  it("carries stable project, client, roadmap and milestone ids", () => {
    const result = buildRouteRequest(project(), intent);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.projectId).toBe("prj-1");
    expect(result.request.clientId).toBe("client-9");
    expect(result.request.roadmapId).toBe("road-3");
    expect(result.request.milestoneId).toBe("mile-7");
    expect(result.request.organizationId).toBe("org-1");
  });

  it("carries evidence, dependencies, boundary and Point A/B without retyping", () => {
    const result = buildRouteRequest(project(), intent);
    if (!result.ok) throw new Error(result.because);
    expect(result.request.evidence).toEqual(project().evidence);
    expect(result.request.dependencies).toEqual(["Stripe account"]);
    expect(result.request.executionBoundary).toBe("No payment processing in v1.");
    expect(result.request.pointA).toBe(project().pointA);
    expect(result.request.pointB).toBe(project().pointB);
  });

  it("invents no priority when the project records none", () => {
    const result = buildRouteRequest(project(), intent);
    if (!result.ok) throw new Error(result.because);
    expect(result.request.priority).toBeUndefined();
    expect(routeMetadata(result.request)["priority"]).toBeUndefined();
  });

  it("is idempotent: the same ask produces the same source event key", () => {
    const a = buildRouteRequest(project(), intent);
    const b = buildRouteRequest(project(), { ...intent, requestedAt: "2026-09-01T00:00:00.000Z" });
    if (!a.ok || !b.ok) throw new Error("expected both routes to build");
    expect(a.request.sourceEventKey).toBe(b.request.sourceEventKey);
    expect(a.request.sourceEventKey).toBe(
      routeSourceEventKey("ops", "prj-1", intent.requestedOutcome),
    );
  });

  it("keys Ops and Studio routes separately", () => {
    const ops = routeSourceEventKey("ops", "prj-1", "x");
    const studio = routeSourceEventKey("studio", "prj-1", "x");
    expect(ops).not.toBe(studio);
  });

  it("never claims the receiving room accepted the work", () => {
    const result = buildRouteRequest(project(), intent);
    if (!result.ok) throw new Error(result.because);
    expect(result.request.status).toBe("requested");
    expect(routeMetadata(result.request)["acceptance"]).toBe("pending_receiving_room");
    expect(routeSummary(result.request)).toContain("not yet accepted");
  });

  it("refuses rather than fabricating missing context", () => {
    expect(buildRouteRequest(project(), { ...intent, requestedOutcome: "  " }).ok).toBe(false);
    expect(buildRouteRequest(project(), { ...intent, because: "" }).ok).toBe(false);
    expect(
      buildRouteRequest(project(), { ...intent, requestedBy: { userId: "" } }).ok,
    ).toBe(false);
    expect(buildRouteRequest(project({ pointB: "  " }), intent).ok).toBe(false);
    expect(buildRouteRequest(project({ id: "" }), intent).ok).toBe(false);
  });

  it("routes only to Ops or Studio", () => {
    const result = buildRouteRequest(project(), {
      ...intent,
      targetApp: "comms" as unknown as "ops",
    });
    expect(result.ok).toBe(false);
  });

  it("lets only Projects emit the route event", () => {
    for (const key of Object.values(ROUTE_EVENT_KEY)) {
      expect(SUITE_EVENTS[key].emittedBy).toBe("projects");
      expect(mayEmit("projects", key)).toBe(true);
      expect(mayEmit("ops", key)).toBe(false);
      expect(mayEmit("steward", key)).toBe(false);
    }
  });

  it("lets only the receiving room emit acceptance and completion", () => {
    for (const key of RECEIVER_EVENT_KEYS.ops) {
      expect(mayEmit("ops", key)).toBe(true);
      expect(mayEmit("projects", key)).toBe(false);
    }
    for (const key of RECEIVER_EVENT_KEYS.studio) {
      expect(mayEmit("studio", key)).toBe(true);
      expect(mayEmit("projects", key)).toBe(false);
    }
  });
});

describe("routing authority", () => {
  it("keeps routing a human, role-bound action in Projects", () => {
    const viewer: AccessContext = {
      userId: "u2",
      organizationId: "org-1",
      role: "viewer",
      active: true,
    };
    const lead: AccessContext = {
      userId: "u1",
      organizationId: "org-1",
      role: "project_lead",
      active: true,
    };
    expect(can(viewer, "projects.write")).toBe(false);
    expect(can(lead, "projects.write")).toBe(true);
    expect(can(null, "projects.write")).toBe(false);
  });
});
