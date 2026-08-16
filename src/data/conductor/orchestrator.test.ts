/**
 * Conductor V2 acceptance: approval is not execution.
 *
 * These tests exercise the pure control layer and the orchestrator's gates
 * with a stub adapter and a stubbed ledger, so they assert the *rules* —
 * approval, selectivity, dependency order, permission, idempotency — without
 * touching Supabase or any room's real service.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildControlledActions,
  controlResponse,
  decideActions,
  routability,
} from "@/data/intelligence/conductor/control";
import { accessContext } from "@/domain/access";
import {
  assertTransition,
  type ControlledAction,
  type ExecutionReceipt,
  type RoomAdapter,
} from "@/domain/conductor-control";
import type { ConductorActionGraph } from "@/domain/conductor";

/* The persistence layer is stubbed: these tests are about rules, not IO. */
const persisted: ControlledAction[] = [];
const receipts: ExecutionReceipt[] = [];
const events: string[] = [];

vi.mock("@/data/supabase/conductor-control-service", () => ({
  loadControlledActions: async () => [],
  loadReceipts: async () => [],
  saveControlledActions: async (actions: ControlledAction[]) => {
    persisted.push(...actions);
    return actions;
  },
  persistActionState: async (action: ControlledAction) => {
    persisted.push(action);
    return action;
  },
  recordReceipt: async (receipt: ExecutionReceipt) => {
    receipts.push(receipt);
    return receipt;
  },
}));

vi.mock("@/data/events/control-events", () => ({
  emitControlEvent: async (input: { key: string }) => {
    events.push(input.key);
  },
}));

const { decide, routeAction, routeApproved } = await import("@/data/conductor/orchestrator");

const ORG = "org-1";
const NOW = "2026-02-01T10:00:00.000Z";

const owner = accessContext({ userId: "u1", organizationId: ORG, role: "owner" });
const member = accessContext({ userId: "u2", organizationId: ORG, role: "member" });
const actor = { id: "u1", label: "Tai" };

function graph(): ConductorActionGraph {
  return {
    id: "graph-1",
    organizationId: ORG,
    purpose: "Recover pipeline",
    createdAt: NOW,
    steps: [
      {
        id: "step-comms",
        owningApp: "comms",
        operation: "comms.draft_reply",
        payload: { relationshipId: "rel-1", body: "Draft" },
        route: "/modules/comms",
        routeLabel: "Open Comms",
        title: "Draft a reply to Ana",
        summary: "Ana has been waiting nine days.",
        willDo: ["Save a draft in Comms"],
        willNotDo: ["Send anything"],
        dependsOn: [],
        consequential: true,
        requiresApproval: true,
        requiredCapability: "comms.write",
        expectedSignal: "A draft exists in Comms.",
        basis: "recommended",
        evidence: [{ label: "Nine days of silence", kind: "computed" }],
      },
      {
        id: "step-projects",
        owningApp: "projects",
        operation: "projects.record_blocker",
        payload: { projectId: "proj-1", blocker: "Waiting on Ana" },
        route: "/modules/projects",
        routeLabel: "Open Projects",
        title: "Record the blocker",
        summary: "Delivery is waiting on that reply.",
        willDo: ["Record a blocker on the project"],
        willNotDo: ["Change the delivery date"],
        dependsOn: ["step-comms"],
        consequential: true,
        requiresApproval: true,
        requiredCapability: "projects.write",
        expectedSignal: "The project shows a blocker.",
        basis: "recommended",
        evidence: [{ label: "Project is waiting", kind: "computed" }],
      },
    ],
  } as ConductorActionGraph;
}

function actions(): ControlledAction[] {
  return buildControlledActions({ organizationId: ORG, graph: graph(), now: NOW });
}

function stubAdapter(room: string, operation: string, outcome: "routed" | "failed"): RoomAdapter {
  return {
    id: `stub.${room}`,
    room,
    operations: [operation],
    boundary: `${room} service`,
    supports: (op) => op === operation,
    canRoute: () => ({ routable: true, because: "ok" }),
    prepare: async () => ({ ready: true, because: "ok" }),
    route: async (action, context) => ({
      id: `receipt:${action.id}`,
      organizationId: action.organizationId,
      actionId: action.id,
      owningApp: room,
      adapterId: `stub.${room}`,
      boundaryCrossed: `${room} service`,
      routedAt: context.now ?? NOW,
      approvedBy: context.approvedBy,
      routedBy: context.actor,
      sourceEventKey: `${action.sourceEventKey}:route`,
      status: outcome === "routed" ? "routed" : "failed",
      ...(outcome === "routed"
        ? { result: { label: `${room} recorded it`, reference: "ref-1" } }
        : { failure: `${room} refused` }),
      resultingState: outcome === "routed" ? "routed" : "failed",
    }),
    readStatus: async () => "routed",
  };
}

const adapters = [
  stubAdapter("comms", "comms.draft_reply", "routed"),
  stubAdapter("projects", "projects.record_blocker", "routed"),
];

beforeEach(() => {
  persisted.length = 0;
  receipts.length = 0;
  events.length = 0;
});

describe("building the queue", () => {
  it("is deterministic and idempotent on the source key", () => {
    const first = actions();
    const second = buildControlledActions({
      organizationId: ORG,
      graph: graph(),
      now: "2026-03-01T00:00:00.000Z",
      existing: first,
    });
    expect(second.map((a) => a.id)).toEqual(first.map((a) => a.id));
    expect(second[0]!.createdAt).toBe(NOW);
    expect(new Set(first.map((a) => a.sourceEventKey)).size).toBe(2);
  });

  it("starts every action proposed and approval-gated", () => {
    for (const action of actions()) {
      expect(action.status).toBe("proposed");
      expect(action.requiresApproval).toBe(true);
      expect(action.owningApp).not.toBe("conductor");
    }
  });
});

describe("lifecycle", () => {
  it("refuses illegal transitions", () => {
    expect(() => assertTransition("proposed", "completed")).toThrow();
    expect(() => assertTransition("rejected", "routed")).toThrow();
    expect(() => assertTransition("approved", "routed")).not.toThrow();
  });
});

describe("approval", () => {
  it("is selective: only the named action moves", async () => {
    const next = await decide(
      actions(),
      [{ actionId: "action:step-comms", kind: "approve" }],
      owner,
      actor,
      NOW,
    );
    expect(next[0]!.status).toBe("approved");
    expect(next[1]!.status).toBe("proposed");
    expect(events).toContain("ACTION_APPROVED");
  });

  it("refuses a role without conductor.approve", async () => {
    await expect(
      decide(actions(), [{ actionId: "action:step-comms", kind: "approve" }], member, actor, NOW),
    ).rejects.toThrow();
  });

  it("records a reason on hold and reject", async () => {
    const next = await decide(
      actions(),
      [{ actionId: "action:step-comms", kind: "hold", reason: "Wrong week" }],
      owner,
      actor,
      NOW,
    );
    expect(next[0]!.status).toBe("held");
    expect(next[0]!.approval?.reason).toBe("Wrong week");
  });
});

describe("routing", () => {
  it("never routes an unapproved action", async () => {
    const list = actions();
    const outcome = await routeAction(list[0]!, list, owner, actor, adapters);
    expect(outcome.action.status).toBe("proposed");
    expect(outcome.refusedBecause).toMatch(/approval/i);
    expect(receipts).toHaveLength(0);
  });

  it("holds a dependent action until its prerequisite has been handed over", async () => {
    const approved = decideActions(
      actions(),
      [
        { actionId: "action:step-comms", kind: "approve" },
        { actionId: "action:step-projects", kind: "approve" },
      ],
      { by: actor, at: NOW, canApprove: true },
    );
    const verdict = routability({
      action: approved[1]!,
      actions: approved,
      adapters,
      access: { can: () => true },
    });
    expect(verdict.routable).toBe(false);
    expect(verdict.refusal).toBe("blocked_by_dependency");
  });

  it("routes an approved action and writes a receipt, never 'completed'", async () => {
    const approved = decideActions(
      actions(),
      [{ actionId: "action:step-comms", kind: "approve" }],
      { by: actor, at: NOW, canApprove: true },
    );
    const outcome = await routeAction(approved[0]!, approved, owner, actor, adapters);
    expect(outcome.action.status).toBe("routed");
    expect(outcome.receipt?.status).toBe("routed");
    expect(receipts).toHaveLength(1);
    expect(events).toContain("ACTION_ROUTED");
    expect(outcome.action.status).not.toBe("completed");
  });

  it("routes in dependency order once the first hand-over succeeds", async () => {
    const approved = decideActions(
      actions(),
      [
        { actionId: "action:step-comms", kind: "approve" },
        { actionId: "action:step-projects", kind: "approve" },
      ],
      { by: actor, at: NOW, canApprove: true },
    );
    const { actions: after } = await routeApproved(approved, owner, actor, adapters);
    expect(after.map((a) => a.status)).toEqual(["routed", "routed"]);
  });

  it("refuses a role without conductor.execute", async () => {
    const approved = decideActions(
      actions(),
      [{ actionId: "action:step-comms", kind: "approve" }],
      { by: actor, at: NOW, canApprove: true },
    );
    const outcome = await routeAction(approved[0]!, approved, member, actor, adapters);
    expect(outcome.action.status).toBe("approved");
    expect(outcome.refusedBecause).toMatch(/role/i);
  });

  it("refuses another organization's action outright", async () => {
    const foreign = { ...actions()[0]!, organizationId: "org-2", status: "approved" as const };
    const outcome = await routeAction(foreign, [foreign], owner, actor, adapters);
    expect(outcome.refusedBecause).toMatch(/another organization/i);
    expect(receipts).toHaveLength(0);
  });

  it("records a failed hand-over honestly and claims nothing", async () => {
    const approved = decideActions(
      actions(),
      [{ actionId: "action:step-comms", kind: "approve" }],
      { by: actor, at: NOW, canApprove: true },
    );
    const failing = [stubAdapter("comms", "comms.draft_reply", "failed")];
    const outcome = await routeAction(approved[0]!, approved, owner, actor, failing);
    expect(outcome.action.status).toBe("failed");
    expect(events).toContain("ACTION_FAILED");
    expect(receipts[0]!.status).toBe("failed");
  });

  it("does not route twice", async () => {
    const approved = decideActions(
      actions(),
      [{ actionId: "action:step-comms", kind: "approve" }],
      { by: actor, at: NOW, canApprove: true },
    );
    const first = await routeAction(approved[0]!, approved, owner, actor, adapters);
    const second = await routeAction(first.action, [first.action], owner, actor, adapters);
    expect(second.refusedBecause).toMatch(/already been handed/i);
    expect(receipts).toHaveLength(1);
  });
});

describe("what the Conductor says about itself", () => {
  it("never claims work is done", () => {
    const response = controlResponse(actions(), adapters, { can: () => true });
    expect(response.statement.toLowerCase()).not.toMatch(/\bdone\b|completed/);
  });
});
