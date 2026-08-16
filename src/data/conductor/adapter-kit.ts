/**
 * Shared plumbing for room adapters.
 *
 * Every adapter builds its receipt the same way and passes the same gate:
 * right room, operation the adapter really supports, and the owning room's own
 * permission still held by the person. Keeping it here means a new adapter
 * cannot quietly skip one of those checks.
 */

import type {
  ActionLifecycleState,
  AdapterContext,
  ControlledAction,
  ExecutionReceipt,
  RoomAdapter,
  RoutingVerdict,
} from "@/domain/conductor-control";

/** A non-empty trimmed string from a payload, or undefined. */
export function requireText(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function adapterReceipt(input: {
  action: ControlledAction;
  adapter: RoomAdapter;
  context: AdapterContext;
  status: ExecutionReceipt["status"];
  resultingState: ActionLifecycleState;
  result?: { reference?: string; label: string };
  failure?: string;
}): ExecutionReceipt {
  const at = input.context.now ?? new Date().toISOString();
  return {
    id: `receipt:${input.action.id}:${at}`,
    organizationId: input.action.organizationId,
    actionId: input.action.id,
    owningApp: input.action.owningApp,
    adapterId: input.adapter.id,
    boundaryCrossed: input.adapter.boundary,
    routedAt: at,
    approvedBy: input.context.approvedBy,
    routedBy: input.context.actor,
    sourceEventKey: input.action.sourceEventKey,
    status: input.status,
    ...(input.result ? { result: input.result } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
    resultingState: input.resultingState,
  };
}

/** Right room, supported operation, room permission held. Fails closed. */
export function roomVerdict(
  adapter: RoomAdapter,
  action: ControlledAction,
  access: { can: (permission: string) => boolean },
): RoutingVerdict | undefined {
  if (action.owningApp !== adapter.room) {
    return {
      routable: false,
      because: `${adapter.room} may not act for ${action.owningApp}.`,
      refusal: "no_adapter",
    };
  }
  if (!adapter.supports(action.operation)) {
    return {
      routable: false,
      because: `${adapter.room} has no service for "${action.operation}".`,
      refusal: "no_adapter",
    };
  }
  if (!access.can(String(action.requiredCapability))) {
    return {
      routable: false,
      because: `Routing this still needs ${action.requiredCapability} in ${adapter.room}.`,
      refusal: "not_permitted",
    };
  }
  return undefined;
}
