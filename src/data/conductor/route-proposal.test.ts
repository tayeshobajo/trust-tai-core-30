import { describe, expect, it } from "vitest";

import { capabilityFor, isSupportedOperation } from "@/domain/adapter-registry";
import { canOpenInConductor, conductorHandoff, readHandoff, routeKeyOf } from "@/data/pulse/handoff";
import type { PulseSignal } from "@/domain/pulse";
import type { RouteLedgerEntry } from "@/domain/route-ledger";

import { ROUTE_WITHDRAW_OPERATION, buildRouteWithdrawalAction, routeStepGap } from "./route-proposal";
import { ROOM_ADAPTERS, operationGap } from "./adapters";

function entry(overrides: Partial<RouteLedgerEntry> = {}): RouteLedgerEntry {
  return {
    key: "project.routed_to_ops:p1",
    organizationId: "org",
    projectId: "p1",
    projectName: "Spartan Security",
    targetApp: "ops",
    requestedOutcome: "Stand up the monitoring stack",
    because: "Delivery needs it before launch.",
    requestedAt: "2026-08-10T00:00:00.000Z",
    evidence: [],
    dependencies: [],
    status: "requested",
    ageDays: 5,
    unanswered: true,
    ...overrides,
  };
}

function routeSignal(): PulseSignal {
  return {
    id: "route:project.routed_to_ops:p1",
    organizationId: "org",
    severity: "act_now",
    category: "delivery",
    area: "delivery",
    title: "Routed work is unanswered after 5 days",
    summary: "Stand up the monitoring stack",
    reason: "Nobody has answered.",
    sourceApp: "projects",
    sourceAppLabel: "Projects",
    entityPath: "Spartan Security › Ops",
    impact: "high",
    ageDays: 5,
    actionLabel: "Chase or withdraw",
    actionRoute: "/modules/projects/p1",
    evidence: [],
    confidence: "high",
    at: "2026-08-10T00:00:00.000Z",
  };
}

describe("ops and routed-work handoff", () => {
  it("lets an Ops signal open in the Conductor", () => {
    expect(canOpenInConductor({ sourceApp: "ops" })).toBe(true);
  });

  it("carries the routed request as a pointer only", () => {
    const handoff = conductorHandoff(routeSignal());
    expect(handoff.route).toBe("project.routed_to_ops:p1");
    expect(routeKeyOf(routeSignal())).toBe("project.routed_to_ops:p1");
    expect(JSON.stringify(handoff)).not.toContain("monitoring stack");
  });

  it("asks whether this house should still be waiting", () => {
    expect(conductorHandoff(routeSignal()).ask).toContain("taken back");
  });

  it("reads the pointer back off a URL", () => {
    const handoff = conductorHandoff(routeSignal());
    expect(readHandoff({ ...handoff })?.route).toBe("project.routed_to_ops:p1");
  });
});

describe("the governed step", () => {
  it("is declared and adapted", () => {
    expect(isSupportedOperation("projects", ROUTE_WITHDRAW_OPERATION)).toBe(true);
    expect(
      ROOM_ADAPTERS.some((adapter) => adapter.supports(ROUTE_WITHDRAW_OPERATION)),
    ).toBe(true);
    expect(capabilityFor("projects", ROUTE_WITHDRAW_OPERATION)?.requiresApproval).toBe(true);
  });

  it("proposes rather than approves", () => {
    const action = buildRouteWithdrawalAction({
      entry: entry(),
      because: "We are handling it in-house.",
      createdAt: "2026-08-15T00:00:00.000Z",
    })!;
    expect(action.status).toBe("proposed");
    expect(action.requiresApproval).toBe(true);
    expect(action.owningApp).toBe("projects");
    expect(action.requiredCapability).toBe("projects.write");
    expect(action.sourceEventKey).toBe("project.routed_to_ops:p1:withdrawn");
  });

  it("says plainly that Ops is untouched", () => {
    const action = buildRouteWithdrawalAction({
      entry: entry(),
      because: "No longer needed.",
      createdAt: "2026-08-15T00:00:00.000Z",
    })!;
    expect(action.boundary.willNotDo.join(" ")).toContain("Ops");
    expect(action.boundary.willDo.join(" ")).toContain("withdrawn");
  });

  it("offers nothing once the receiving room has accepted", () => {
    const accepted = entry({ status: "accepted" });
    expect(routeStepGap(accepted)).toContain("accepted");
    expect(buildRouteWithdrawalAction({ entry: accepted, because: "x", createdAt: "now" })).toBeUndefined();
  });

  it("offers nothing while the silence is still short", () => {
    const fresh = entry({ ageDays: 1, unanswered: false });
    expect(buildRouteWithdrawalAction({ entry: fresh, because: "x", createdAt: "now" })).toBeUndefined();
  });

  it("never lets anything accept work for Ops", () => {
    expect(isSupportedOperation("ops", "ops.accept_routed_work")).toBe(false);
    expect(operationGap("ops", "ops.accept_routed_work")).toContain("own word");
    expect(ROOM_ADAPTERS.some((adapter) => adapter.room === "ops")).toBe(false);
  });
});
