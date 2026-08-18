/**
 * Trust Tai OS, Conductor governance events.
 *
 * These are deliberately *not* in `src/domain/events.ts`. That file is the
 * shared business vocabulary: only a business room may emit it, because only a
 * business room owns the state it reports. The events here report something
 * else entirely, what the Conductor proposed and what a person decided about
 * it. They are the audit trail of governance, not a second copy of anyone's
 * truth, and no room reads them to learn what happened in another room.
 *
 * They land in the same append-only `public.activities` stream, scoped to the
 * `conductor` activity scope, with a stable `sourceEventKey` so a retried
 * approval or route never writes history twice.
 */

import type { ActivityName, Provenance } from "./activity";
import type { ID, ISODateTime } from "./entities";

export interface ControlEventDefinition {
  name: ActivityName;
  /** Always the Conductor. No room may emit governance history. */
  emittedBy: "conductor";
  meaning: string;
}

export const CONTROL_EVENTS = {
  ACTION_PROPOSED: {
    name: "conductor.action_proposed",
    emittedBy: "conductor",
    meaning: "The Conductor prepared a bounded action and put it in front of a person.",
  },
  ACTION_APPROVED: {
    name: "conductor.action_approved",
    emittedBy: "conductor",
    meaning: "A person allowed the action. Permission only, nothing has been carried out.",
  },
  ACTION_HELD: {
    name: "conductor.action_held",
    emittedBy: "conductor",
    meaning: "A person parked the action with a reason. It may be approved later.",
  },
  ACTION_REJECTED: {
    name: "conductor.action_rejected",
    emittedBy: "conductor",
    meaning: "A person refused the action with a reason. It is closed.",
  },
  ACTION_WITHDRAWN: {
    name: "conductor.action_withdrawn",
    emittedBy: "conductor",
    meaning: "An approved action was taken back before any room acted on it.",
  },
  ACTION_ROUTED: {
    name: "conductor.action_routed",
    emittedBy: "conductor",
    meaning:
      "An approved action was handed to the owning room's service. A request, never completion.",
  },
  ACTION_FAILED: {
    name: "conductor.action_failed",
    emittedBy: "conductor",
    meaning: "Handing the action over failed. The owning room holds nothing new.",
  },
  ACTION_COMPLETED: {
    name: "conductor.action_completed",
    emittedBy: "conductor",
    meaning:
      "The owning room reported the routed work finished. Recorded from that room, never assumed.",
  },
  ACTION_MEASURED: {
    name: "conductor.action_measured",
    emittedBy: "conductor",
    meaning: "The expected signal was observed and the outcome attached to the action.",
  },
} as const satisfies Record<string, ControlEventDefinition>;

export type ControlEventKey = keyof typeof CONTROL_EVENTS;
export type ControlEventName = (typeof CONTROL_EVENTS)[ControlEventKey]["name"];

export const CONTROL_EVENT_LIST: ControlEventDefinition[] = Object.values(CONTROL_EVENTS);

export function isControlEvent(name: string): name is ControlEventName {
  return CONTROL_EVENT_LIST.some((definition) => definition.name === name);
}

export interface ControlEventInput {
  key: ControlEventKey;
  organizationId: ID;
  actionId: ID;
  owningApp: string;
  actor: Provenance["actor"];
  summary: string;
  metadata?: Record<string, unknown>;
  /** Stable per action *and* per lifecycle step, so retries are no-ops. */
  sourceEventKey: string;
  occurredAt?: ISODateTime;
}

/** The idempotency key for one governance moment about one action. */
export function controlEventKey(key: ControlEventKey, actionId: ID): string {
  return `${CONTROL_EVENTS[key].name}:${actionId}`;
}
