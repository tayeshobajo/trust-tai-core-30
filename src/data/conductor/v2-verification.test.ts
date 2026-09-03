/**
 * Conductor V2 verification pass, three-branch controlled plan.
 *
 * Unlike `orchestrator.test.ts` (pure rules, stub adapters), this exercises the
 * REAL room adapters (`ROOM_ADAPTERS`) and the real governance event vocabulary,
 * with only the outermost IO replaced:
 *   - `conductor-control-service` → an in-memory ledger with the same
 *     `(organization_id, source_event_key)` uniqueness as the SQL schema.
 *   - `supabaseActivity.record` → an in-memory activity stream.
 *   - `commsService` / `projectsService` → spies, so we can prove that each
 *     approved branch touches ONLY its owning room's service boundary.
 *
 * The held branch is proved inert: no adapter call, no owning-room mutation,
 * across route, retry and reload.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildControlledActions } from "@/data/intelligence/conductor/control";
import { accessContext } from "@/domain/access";
import type { ControlledAction, ExecutionReceipt } from "@/domain/conductor-control";
import type { ConductorActionGraph } from "@/domain/conductor";

/* ------------------------------------------------------- in-memory ledger */

const actionRows = new Map<string, ControlledAction>();
const receiptRows = new Map<string, ExecutionReceipt>();
const activityRows: Array<{ name: string; payload: Record<string, unknown> }> = [];

const key = (organizationId: string, sourceEventKey: string) =>
  `${organizationId}::${sourceEventKey}`;

vi.mock("@/data/supabase/conductor-control-service", () => ({
  loadControlledActions: async (organizationId: string) =>
    [...actionRows.values()].filter((row) => row.organizationId === organizationId),
  loadReceipts: async (organizationId: string) =>
    [...receiptRows.values()].filter((row) => row.organizationId === organizationId),
  saveControlledActions: async (actions: ControlledAction[]) =>
    actions.map((action) => {
      const id = key(action.organizationId, action.sourceEventKey);
      const existing = actionRows.get(id);
      // upsert on (organization_id, source_event_key): never a second row
      const merged = existing ? {...existing }: action;
      actionRows.set(id, merged);
      return merged;
    }),
  persistActionState: async (action: ControlledAction) => {
    actionRows.set(key(action.organizationId, action.sourceEventKey), action);
    return action;
  },
  recordReceipt: async (receipt: ExecutionReceipt) => {
    const id = key(receipt.organizationId, receipt.sourceEventKey);
    const existing = receiptRows.get(id);
    if (existing) return existing; // unique constraint → no duplicate receipt
    receiptRows.set(id, receipt);
    return receipt;
  },
}));

vi.mock("@/data/supabase/activities", () => ({
  supabaseActivity: {
    record: async (input: { name: string; payload: Record<string, unknown> }) => {
      activityRows.push({ name: input.name, payload: input.payload });
      return null;
    },
  },
}));

/* ------------------------------------------------------------ room spies */

const saveDraft = vi.fn(async () => ({ id: "draft-1" }));
const commsList = vi.fn(async () => [{ id: "rel-1", name: "Ana" }]);
const commsSend = vi.fn();

vi.mock("@/data/supabase/comms-service", () => ({
  commsService: {
    list: (...args: unknown[]) => commsList(...(args as [])),
    saveDraft: (...args: unknown[]) => saveDraft(...(args as [])),
    send: (...args: unknown[]) => commsSend(...(args as [])),
  },
}));

const projectUpdate = vi.fn(async () => ({ id: "proj-1" }));
const projectGet = vi.fn(async () => ({ id: "proj-1", name: "Delivery" }));
const projectRoute = vi.fn();

vi.mock("@/data/supabase/projects-service", () => ({
  projectsService: {
    get: (...args: unknown[]) => projectGet(...(args as [])),
    update: (...args: unknown[]) => projectUpdate(...(args as [])),
    routeWork: (...args: unknown[]) => projectRoute(...(args as [])),
  },
}));

const { decide, publishProposedActions, routeApproved, loadControl } = await import(
  "@/data/conductor/orchestrator"
);

/* ------------------------------------------------------------- the plan */

const ORG = "org-verify";
const NOW = "2026-08-16T02:00:00.000Z";
const owner = accessContext({ userId: "u1", organizationId: ORG, role: "owner" });
const actor = { id: "u1", label: "Tai" };

function graph(): ConductorActionGraph {
  const base = {
    dependsOn: [] as string[],
    consequential: true as const,
    requiresApproval: true as const,
    basis: "recommended" as const,
    evidence: [{ label: "Observed in the suite", kind: "computed" as const }],
  };
  return {
    id: "graph-verify",
    organizationId: ORG,
    purpose: "Three-branch verification plan",
    requiresApproval: true,
    owningApps: ["comms", "projects"],
    generatedAt: NOW,
    steps: [
      {
...base,
        id: "branch-comms",
        owningApp: "comms",
        operation: "comms.draft_reply",
        payload: { relationshipId: "rel-1", body: "A prepared reply." },
        route: "/modules/comms",
        routeLabel: "Open Comms",
        title: "Draft a reply to Ana",
        summary: "Ana has been waiting.",
        willDo: ["Save an unsent draft"],
        willNotDo: ["Send anything"],
        requiredCapability: "comms.write",
        expectedSignal: "A draft exists in Comms.",
      },
      {
...base,
        id: "branch-projects",
        owningApp: "projects",
        operation: "projects.record_blocker",
        payload: { projectId: "proj-1", blocker: "Waiting on Ana" },
        route: "/modules/projects",
        routeLabel: "Open Projects",
        title: "Record the blocker",
        summary: "Delivery is waiting.",
        willDo: ["Record a blocker"],
        willNotDo: ["Change the date"],
        requiredCapability: "projects.write",
        expectedSignal: "The project shows a blocker.",
      },
      {
...base,
        id: "branch-held",
        owningApp: "comms",
        operation: "comms.draft_reply",
        payload: { relationshipId: "rel-1", body: "A second reply, too early." },
        route: "/modules/comms",
        routeLabel: "Open Comms",
        title: "Draft a second reply",
        summary: "Probably premature.",
        willDo: ["Save an unsent draft"],
        willNotDo: ["Send anything"],
        requiredCapability: "comms.write",
        expectedSignal: "A draft exists in Comms.",
      },
    ],
  };
}

const names = () => activityRows.map((row) => row.name);
const byId = (list: ControlledAction[], id: string) => list.find((row) => row.id === id)!;

async function runPass() {
  const proposed = await publishProposedActions(
    buildControlledActions({ organizationId: ORG, graph: graph(), now: NOW }),
    owner,
    actor,
  );
  const decided = await decide(
    proposed,
    [
      { actionId: "action:branch-comms", kind: "approve" },
      { actionId: "action:branch-projects", kind: "approve" },
      { actionId: "action:branch-held", kind: "hold", reason: "Too early, one reply is enough." },
    ],
    owner,
    actor,
    NOW,
  );
  return routeApproved(decided, owner, actor);
}

beforeEach(() => {
  actionRows.clear();
  receiptRows.clear();
  activityRows.length = 0;
  vi.clearAllMocks();
});

describe("Conductor V2, three-branch controlled plan", () => {
  it("1. a cross-room plan produces three governed actions", async () => {
    const proposed = await publishProposedActions(
      buildControlledActions({ organizationId: ORG, graph: graph(), now: NOW }),
      owner,
      actor,
    );
    expect(proposed).toHaveLength(3);
    expect(proposed.map((a) => a.owningApp)).toEqual(["comms", "projects", "comms"]);
    expect(proposed.every((a) => a.status === "proposed")).toBe(true);
    expect(new Set(proposed.map((a) => a.sourceEventKey)).size).toBe(3);
    expect(names().filter((n) => n === "conductor.action_proposed")).toHaveLength(3);
  });

  it("2+3. approved branches route only through their owning room's boundary", async () => {
    const { actions, outcomes } = await runPass();
    expect(byId(actions, "action:branch-comms").status).toBe("routed");
    expect(byId(actions, "action:branch-projects").status).toBe("routed");

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(commsSend).not.toHaveBeenCalled();
    expect(projectUpdate).toHaveBeenCalledTimes(1);
    expect(projectRoute).not.toHaveBeenCalled();
    // Projects never reached through Comms, Comms never through Projects.
    expect(outcomes.map((o) => o.receipt?.adapterId)).toEqual([
      "adapter:comms.draft",
      "adapter:projects.blocker",
    ]);
    // The Projects adapter records a blocker only, nothing else.
    const patch = (projectUpdate.mock.calls as unknown as unknown[][])[0]![1] as object;
    expect(Object.keys(patch)).toEqual(["blockedBecause"]);
  });

  it("4+5. the held branch persists its decision and reason, and has no room effect", async () => {
    const { actions } = await runPass();
    const held = byId(actions, "action:branch-held");
    expect(held.status).toBe("held");
    expect(held.approval?.kind).toBe("hold");
    expect(held.approval?.reason).toBe("Too early, one reply is enough.");

    const stored = (await loadControl(ORG)).find((a) => a.id === held.id)!;
    expect(stored.status).toBe("held");
    expect(stored.approval?.reason).toBe("Too early, one reply is enough.");
    // Only the approved Comms branch produced a draft.
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(receiptRows.size).toBe(2);
    expect([...receiptRows.values()].some((r) => r.actionId === held.id)).toBe(false);
  });

  it("6. receipts carry room, adapter, approver, sourceEventKey and resulting state", async () => {
    await runPass();
    for (const receipt of receiptRows.values()) {
      expect(receipt.owningApp).toMatch(/comms|projects/);
      expect(receipt.adapterId).toMatch(/^adapter:/);
      expect(receipt.boundaryCrossed.length).toBeGreaterThan(0);
      expect(receipt.approvedBy.id).toBe("u1");
      expect(receipt.routedBy.id).toBe("u1");
      expect(receipt.sourceEventKey.length).toBeGreaterThan(0);
      expect(receipt.status).toBe("routed");
      expect(receipt.resultingState).toBe("routed");
      expect(receipt.result?.reference).toBeTruthy();
    }
  });

  it("7. the activity stream records the lifecycle actually reached", async () => {
    await runPass();
    const counted = names().reduce<Record<string, number>>((acc, name) => {
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    expect(counted["conductor.action_proposed"]).toBe(3);
    expect(counted["conductor.action_approved"]).toBe(2);
    expect(counted["conductor.action_held"]).toBe(1);
    expect(counted["conductor.action_routed"]).toBe(2);
    expect(counted["conductor.action_failed"]).toBeUndefined();
    expect(counted["conductor.action_completed"]).toBeUndefined();
    for (const row of activityRows) {
      expect(row.payload["source_event_key"]).toBeTruthy();
      expect(row.payload["conductor_action_id"]).toBeTruthy();
    }
  });

  it("8+9. retrying is idempotent and the held branch stays held", async () => {
    const first = await runPass();
    const receiptsAfterFirst = receiptRows.size;
    const actionsAfterFirst = actionRows.size;

    // Retry: re-publish the same plan, re-decide, re-route from persisted state.
    const reloaded = await loadControl(ORG);
    const second = await routeApproved(reloaded, owner, actor);

    expect(actionRows.size).toBe(actionsAfterFirst);
    expect(receiptRows.size).toBe(receiptsAfterFirst);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(projectUpdate).toHaveBeenCalledTimes(1);
    expect(second.outcomes).toHaveLength(0); // nothing was still approved-and-waiting

    const republished = await publishProposedActions(
      buildControlledActions({ organizationId: ORG, graph: graph(), now: NOW }),
      owner,
      actor,
    );
    expect(actionRows.size).toBe(actionsAfterFirst);
    expect(byId(republished, "action:branch-held").status).toBe("held");
    expect(byId(republished, "action:branch-comms").status).toBe("routed");

    const held = byId(await loadControl(ORG), "action:branch-held");
    expect(held.status).toBe("held");
    expect(held.approval?.reason).toBe("Too early, one reply is enough.");
    expect(first.outcomes).toHaveLength(2);
  });
});
