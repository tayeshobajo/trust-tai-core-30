/**
 * Room adapters — the only way the Conductor may reach another room.
 *
 * Each adapter calls the *existing* service of the room that owns the change,
 * with that room's own permission still required of the person. There is no
 * generic table write here and no path to one: an operation with no adapter
 * stays approved-but-not-routable, and says which capability is missing.
 *
 * V2 deliberately adapts a narrow, safe set: internal preparation and small
 * reversible internal changes. Nothing that sends, publishes, prices or spends.
 */

import { commsService } from "@/data/supabase/comms-service";
import { projectsService } from "@/data/supabase/projects-service";
import type {
  ActionLifecycleState,
  AdapterContext,
  AdapterPreparation,
  ControlledAction,
  ExecutionReceipt,
  RoomAdapter,
  RoutingVerdict,
} from "@/domain/conductor-control";

function text(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function receipt(input: {
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

/** Shared gate: right room, right operation, room permission held. */
function baseVerdict(
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

/* --------------------------------------------------------------- Comms */

/**
 * Comms: prepare an unsent draft.
 *
 * The only thing this crosses into Comms with is `commsService.saveDraft`, that needs human review. No message is sent, no relationship stage moves.
 */
export const commsDraftAdapter: RoomAdapter = {
  id: "adapter:comms.draft",
  room: "comms",
  operations: ["comms.draft_reply"],
  boundary: "commsService.saveDraft — an unsent draft that needs human review",
  supports(operation) {
    return this.operations.includes(operation);
  },
  canRoute(action, access) {
    const refused = baseVerdict(this, action, access);
    if (refused) return refused;
    const relationshipId = text(action.payload, "relationshipId");
    const body = text(action.payload, "body");
    if (!relationshipId || !body) {
      return {
        routable: false,
        because:
          "Comms can hold a prepared draft, but this action carries no relationship and no drafted text. Prepare it in Comms.",
        refusal: "missing_input",
      };
    }
    return { routable: true, because: "Comms will hold an unsent draft for you to edit." };
  },
  async prepare(action): Promise<AdapterPreparation> {
    const relationshipId = text(action.payload, "relationshipId");
    const body = text(action.payload, "body");
    if (!relationshipId || !body) {
      return {
        ready: false,
        because: "A relationship reference and drafted text are required before Comms can hold it.",
      };
    }
    return {
      ready: true,
      because: "Comms will store this as an unsent draft.",
      payload: { relationshipId, body, subject: text(action.payload, "subject") },
    };
  },
  async route(action, context) {
    const prepared = await this.prepare(action, context);
    if (!prepared.ready) {
      return receipt({
        action,
        adapter: this,
        context,
        status: "refused",
        resultingState: "approved",
        failure: prepared.because,
      });
    }
    const relationshipId = String(prepared.payload!["relationshipId"]);
    try {
      const relationships = await commsService.list(context.organizationId);
      const relationship = relationships.find((row) => row.id === relationshipId);
      if (!relationship) {
        return receipt({
          action,
          adapter: this,
          context,
          status: "refused",
          resultingState: "approved",
          failure: "That relationship is not in this organization's Comms.",
        });
      }
      const draft = await commsService.saveDraft(
        {
          relationship,
          register: "follow_up",
          intent: action.operation,
          ...(prepared.payload!["subject"]
            ? { subject: String(prepared.payload!["subject"]) }
            : {}),
          body: String(prepared.payload!["body"]),
          reviewState: "needs_human_review",
          rationale: {
            conductor_action: action.id,
            source_event_key: action.sourceEventKey,
            approved_by: context.approvedBy.id,
          },
          evidence: action.evidence,
        },
        { organizationId: context.organizationId, userId: context.actor.id },
      );
      return receipt({
        action,
        adapter: this,
        context,
        status: "routed",
        resultingState: "routed",
        result: { reference: draft.id, label: "Unsent draft waiting in Comms" },
      });
    } catch (error) {
      return receipt({
        action,
        adapter: this,
        context,
        status: "failed",
        resultingState: "failed",
        failure: (error as Error).message,
      });
    }
  },
  async readStatus(action) {
    /* Comms owns what happens next; the Conductor never infers completion. */
    return action.status;
  },
};

/* ------------------------------------------------------------- Projects */

/**
 * Projects: record what a stalled project is waiting on.
 *
 * Crosses `projectsService.update` only, with `projects.write` required. It
 * does not change state, owner or dates.
 */
export const projectsBlockerAdapter: RoomAdapter = {
  id: "adapter:projects.blocker",
  room: "projects",
  operations: ["projects.record_blocker"],
  boundary: "projectsService.update — records blockedBecause only",
  supports(operation) {
    return this.operations.includes(operation);
  },
  canRoute(action, access) {
    const refused = baseVerdict(this, action, access);
    if (refused) return refused;
    const projectId = text(action.payload, "projectId");
    const blocker = text(action.payload, "blocker");
    if (!projectId || !blocker) {
      return {
        routable: false,
        because:
          "Projects can record a blocker, but this action names no project and no blocker text. Name them in Projects.",
        refusal: "missing_input",
      };
    }
    return { routable: true, because: "Projects will record what the work is waiting on." };
  },
  async prepare(action): Promise<AdapterPreparation> {
    const projectId = text(action.payload, "projectId");
    const blocker = text(action.payload, "blocker");
    if (!projectId || !blocker) {
      return { ready: false, because: "A project reference and blocker text are required." };
    }
    return { ready: true, because: "Projects will record the blocker.", payload: { projectId, blocker } };
  },
  async route(action, context) {
    const prepared = await this.prepare(action, context);
    if (!prepared.ready) {
      return receipt({
        action,
        adapter: this,
        context,
        status: "refused",
        resultingState: "approved",
        failure: prepared.because,
      });
    }
    try {
      const project = await projectsService.get(
        String(prepared.payload!["projectId"]),
        context.organizationId,
      );
      if (!project) {
        return receipt({
          action,
          adapter: this,
          context,
          status: "refused",
          resultingState: "approved",
          failure: "That project is not in this organization.",
        });
      }
      await projectsService.update(
        project,
        { blockedBecause: String(prepared.payload!["blocker"]) },
        {
          organizationId: context.organizationId,
          userId: context.actor.id,
          userLabel: context.actor.label,
        },
      );
      return receipt({
        action,
        adapter: this,
        context,
        status: "routed",
        resultingState: "routed",
        result: { reference: project.id, label: `Blocker recorded on ${project.name}` },
      });
    } catch (error) {
      return receipt({
        action,
        adapter: this,
        context,
        status: "failed",
        resultingState: "failed",
        failure: (error as Error).message,
      });
    }
  },
  async readStatus(action) {
    return action.status;
  },
};

/** Every adapter the Conductor may use. Adding one is a product decision. */
export const ROOM_ADAPTERS: RoomAdapter[] = [commsDraftAdapter, projectsBlockerAdapter];

/**
 * Rooms with no adapter, and the honest reason. Shown in the control surface
 * so "not routable" is never mistaken for "failed" or for "done".
 */
export const ADAPTER_GAPS: { room: string; because: string }[] = [
  {
    room: "scout",
    because:
      "Scout's handoff needs a prepared brief with a named contact, which only Scout's board can assemble today.",
  },
  {
    room: "roadmap",
    because:
      "Sequencing a capability is a decided commitment. Roadmap exposes no service that accepts it from outside the room.",
  },
  {
    room: "steward",
    because: "Steward interprets. It holds no executable work for the Conductor to route.",
  },
  {
    room: "ops",
    because:
      "Ops is an external application reached through SSO. It accepts routed work from Projects, not from the Conductor.",
  },
  {
    room: "studio",
    because: "Studio has no execution service yet, so nothing may claim to have been routed to it.",
  },
];

export function adapterGap(room: string): string | undefined {
  return ADAPTER_GAPS.find((gap) => gap.room === room)?.because;
}
