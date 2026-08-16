/**
 * The orchestrator: pure rules, real boundaries.
 *
 * It puts three things together and nothing else — the pure control layer
 * (what may happen), the room adapters (the only way out of the Conductor),
 * and the governance ledger (what actually happened). Every step writes a
 * receipt and a governance event, and no step ever claims more than it did.
 *
 *   approve → permission recorded.
 *   route   → the owning room's service was called, and a receipt says so.
 *   complete→ only when the owning room reports it. Never inferred here.
 */

import { ROOM_ADAPTERS, adapterGap } from "@/data/conductor/adapters";
import { emitControlEvent } from "@/data/events/control-events";
import {
  adapterContext,
  adapterFor,
  approveAll,
  controlResponse,
  decideActions,
  routability,
  type ApprovalDecision,
} from "@/data/intelligence/conductor/control";
import {
  loadControlledActions,
  persistActionState,
  recordReceipt,
  saveControlledActions,
} from "@/data/supabase/conductor-control-service";
import { can, type AccessContext } from "@/domain/access";
import { controlEventKey } from "@/domain/control-events";
import type {
  ControlResponse,
  ControlledAction,
  ExecutionReceipt,
  RoomAdapter,
} from "@/domain/conductor-control";
import { assertTransition } from "@/domain/conductor-control";

export interface ControlActor {
  id: string;
  label: string;
}

function accessGate(access: AccessContext) {
  return { can: (permission: string) => can(access, permission as never) };
}

/** Persist a freshly prepared queue and announce it. Nothing is decided yet. */
export async function publishProposedActions(
  actions: ControlledAction[],
  access: AccessContext,
  actor: ControlActor,
): Promise<ControlledAction[]> {
  const scoped = actions.filter((action) => action.organizationId === access.organizationId);
  const saved = await saveControlledActions(scoped);
  await Promise.all(
    saved
      .filter((action) => action.status === "proposed")
      .map((action) =>
        emitControlEvent({
          key: "ACTION_PROPOSED",
          organizationId: action.organizationId,
          actionId: action.id,
          owningApp: action.owningApp,
          actor: { type: "intelligence", id: actor.id, label: actor.label },
          summary: `Prepared for ${action.owningApp}: ${action.intent}. Nothing has happened.`,
          sourceEventKey: controlEventKey("ACTION_PROPOSED", action.id),
          metadata: { operation: action.operation, consequence: action.consequence },
        }),
      ),
  );
  return saved;
}

const DECISION_EVENT = {
  approve: "ACTION_APPROVED",
  hold: "ACTION_HELD",
  reject: "ACTION_REJECTED",
  withdraw: "ACTION_WITHDRAWN",
} as const;

/**
 * Record a person's decisions. Selective: only the named actions move, and
 * approving something is explicitly not doing it.
 */
export async function decide(
  actions: ControlledAction[],
  decisions: ApprovalDecision[],
  access: AccessContext,
  actor: ControlActor,
  now = new Date().toISOString(),
): Promise<ControlledAction[]> {
  const context = { by: actor, at: now, canApprove: can(access, "conductor.approve") };
  const next = decideActions(actions, decisions, context);

  const changed = next.filter((action, index) => action !== actions[index]);
  for (const action of changed) {
    if (action.organizationId !== access.organizationId) {
      throw new Error("That action belongs to another organization.");
    }
    await persistActionState(action);
    const kind = action.approval?.kind ?? "approve";
    await emitControlEvent({
      key: DECISION_EVENT[kind],
      organizationId: action.organizationId,
      actionId: action.id,
      owningApp: action.owningApp,
      actor: { type: "user", id: actor.id, label: actor.label },
      summary:
        kind === "approve"
          ? `${actor.label} approved "${action.intent}" for ${action.owningApp}. Approval is permission, not execution.`
          : `${actor.label} ${kind === "hold" ? "held" : kind === "reject" ? "rejected" : "withdrew"} "${action.intent}": ${action.approval?.reason ?? "no reason given"}.`,
      sourceEventKey: controlEventKey(DECISION_EVENT[kind], action.id),
      metadata: { operation: action.operation, reason: action.approval?.reason ?? null },
    });
  }
  return next;
}

/** Approve everything still awaiting a decision, in one act, auditably. */
export async function approveEverything(
  actions: ControlledAction[],
  access: AccessContext,
  actor: ControlActor,
  now = new Date().toISOString(),
): Promise<ControlledAction[]> {
  const context = { by: actor, at: now, canApprove: can(access, "conductor.approve") };
  const approved = approveAll(actions, context);
  const decisions: ApprovalDecision[] = approved
    .filter((action, index) => action !== actions[index])
    .map((action) => ({ actionId: action.id, kind: "approve" as const }));
  return decide(actions, decisions, access, actor, now);
}

export interface RoutingOutcome {
  action: ControlledAction;
  receipt?: ExecutionReceipt;
  /** Present when nothing was routed, in plain language. */
  refusedBecause?: string;
}

/**
 * Hand one approved action to the room that owns it.
 *
 * Fails closed at every gate: organization, approval, dependency, permission,
 * adapter. A route that cannot happen produces an explanation, never a
 * pretend success, and never a "completed".
 */
export async function routeAction(
  action: ControlledAction,
  actions: ControlledAction[],
  access: AccessContext,
  actor: ControlActor,
  adapters: RoomAdapter[] = ROOM_ADAPTERS,
  now = new Date().toISOString(),
): Promise<RoutingOutcome> {
  if (action.organizationId !== access.organizationId) {
    return { action, refusedBecause: "That action belongs to another organization." };
  }

  const verdict = routability({ action, actions, adapters, access: accessGate(access) });
  if (!verdict.routable) {
    const gap = verdict.refusal === "no_adapter" ? adapterGap(action.owningApp) : undefined;
    return { action, refusedBecause: gap ? `${verdict.because} ${gap}` : verdict.because };
  }

  const adapter = adapterFor(adapters, action)!;
  const receipt = await adapter.route(action, adapterContext(action, actor, now));
  await recordReceipt(receipt).catch(() => undefined);

  if (receipt.status !== "routed") {
    const failed =
      receipt.resultingState === "failed"
        ? { ...action, status: "failed" as const, receiptId: receipt.id }
        : { ...action, receiptId: receipt.id };
    if (receipt.resultingState === "failed") assertTransition(action.status, "failed");
    await persistActionState(failed).catch(() => undefined);
    await emitControlEvent({
      key: "ACTION_FAILED",
      organizationId: action.organizationId,
      actionId: action.id,
      owningApp: action.owningApp,
      actor: { type: "user", id: actor.id, label: actor.label },
      summary: `Handing "${action.intent}" to ${action.owningApp} did not happen: ${receipt.failure ?? "refused"}. That room holds nothing new.`,
      sourceEventKey: controlEventKey("ACTION_FAILED", action.id),
      metadata: { adapter: adapter.id, status: receipt.status },
    });
    return { action: failed, receipt, refusedBecause: receipt.failure ?? "Refused by the adapter." };
  }

  assertTransition(action.status, "routed");
  const routed: ControlledAction = {
    ...action,
    status: "routed",
    routedAt: receipt.routedAt,
    receiptId: receipt.id,
  };
  await persistActionState(routed).catch(() => undefined);
  await emitControlEvent({
    key: "ACTION_ROUTED",
    organizationId: action.organizationId,
    actionId: action.id,
    owningApp: action.owningApp,
    actor: { type: "user", id: actor.id, label: actor.label },
    summary: `"${action.intent}" was handed to ${action.owningApp} through ${adapter.boundary}. ${action.owningApp} decides what happens next.`,
    sourceEventKey: controlEventKey("ACTION_ROUTED", action.id),
    metadata: {
      adapter: adapter.id,
      approved_by: action.approval?.by.id ?? null,
      result: receipt.result?.reference ?? null,
    },
  });
  return { action: routed, receipt };
}

/** Route every action that may legitimately move. Order follows dependencies. */
export async function routeApproved(
  actions: ControlledAction[],
  access: AccessContext,
  actor: ControlActor,
  adapters: RoomAdapter[] = ROOM_ADAPTERS,
): Promise<{ actions: ControlledAction[]; outcomes: RoutingOutcome[] }> {
  let current = [...actions];
  const outcomes: RoutingOutcome[] = [];
  for (const action of actions) {
    const live = current.find((row) => row.id === action.id)!;
    if (live.status !== "approved") continue;
    const outcome = await routeAction(live, current, access, actor, adapters);
    outcomes.push(outcome);
    current = current.map((row) => (row.id === outcome.action.id ? outcome.action : row));
  }
  return { actions: current, outcomes };
}

/** The whole control picture, said honestly. */
export function describeControl(
  actions: ControlledAction[],
  access: AccessContext,
  adapters: RoomAdapter[] = ROOM_ADAPTERS,
): ControlResponse {
  return controlResponse(actions, adapters, accessGate(access));
}

export async function loadControl(organizationId: string): Promise<ControlledAction[]> {
  return loadControlledActions(organizationId);
}
