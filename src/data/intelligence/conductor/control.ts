/**
 * The Conductor's control loop — pure.
 *
 * Everything here is arithmetic over data: turning a prepared action graph
 * into governed actions, applying a person's decisions, working out what may
 * legitimately be routed, and describing the result honestly. There is no
 * database call and no room service call in this module by design, so the
 * rules can be tested exactly as they are enforced.
 *
 * Three sentences hold the whole file together:
 *   Approval is not execution. Routing is not completion. No adapter, no
 *   execution claim.
 */

import type { EvidenceRef } from "@/domain/confidence";
import { actionPermission } from "@/domain/action-authority";
import type {
  ActionLifecycleState,
  ActionOutcome,
  AdapterContext,
  ApprovalDecisionKind,
  ConsequenceClass,
  ControlResponse,
  ControlledAction,
  RoomAdapter,
  RoutingVerdict,
} from "@/domain/conductor-control";
import {
  assertTransition,
  controlSourceEventKey,
  isRoutableConsequence,
  needsApproval,
} from "@/domain/conductor-control";
import type { ConductorActionGraph, ConductorActionStep } from "@/domain/conductor";

/* ------------------------------------------------------------ consequence */

/**
 * How much of the world each known operation touches.
 *
 * Unlisted operations are treated as `internal_change`: gated, and — unless a
 * room adapter claims them — not routable. Guessing "harmless" is the one
 * mistake this table exists to prevent.
 */
const OPERATION_CONSEQUENCE: Record<string, ConsequenceClass> = {
  "scout.open_discovery": "informational",
  "scout.review_strong_fit": "informational",
  "comms.open_quiet_relationships": "informational",
  "steward.review_overdue_commitments": "informational",
  "projects.record_blocker": "internal_change",
  "scout.route_to_comms": "internal_change",
  "comms.draft_reply": "internal_preparation",
  "scout.start_discovery_run": "internal_change",
  "scout.record_fit_correction": "internal_change",
  "roadmap.create_shell": "internal_preparation",
  "roadmap.request_decision": "internal_preparation",
  "roadmap.sequence_capability": "internal_change",
  "comms.send": "external",
  "studio.publish": "external",
};

export function consequenceOf(operation: string): ConsequenceClass {
  return OPERATION_CONSEQUENCE[operation] ?? "internal_change";
}

/* ------------------------------------------------------ building the queue */

export interface BuildControlledActionsInput {
  organizationId: string;
  graph: ConductorActionGraph;
  answerId?: string;
  planId?: string;
  now: string;
  /** Existing governed actions, so a re-asked question does not duplicate them. */
  existing?: ControlledAction[];
}

function whyFrom(step: ConductorActionStep): string {
  const first = step.evidence[0]?.label;
  return first ? `${step.summary} (${first})` : step.summary;
}

/**
 * Turn a prepared graph into governed actions.
 *
 * Deterministic and idempotent: the same graph yields the same actions with
 * the same idempotency keys, and any action already governed is returned as it
 * stands rather than reset to `proposed`.
 */
export function buildControlledActions(
  input: BuildControlledActionsInput,
): ControlledAction[] {
  const { organizationId, graph, now } = input;
  const byKey = new Map((input.existing ?? []).map((action) => [action.sourceEventKey, action]));

  return graph.steps.map((step) => {
    const consequence = consequenceOf(step.operation ?? step.id);
    const sourceEventKey = controlSourceEventKey({
      organizationId,
      owningApp: step.owningApp,
      operation: step.operation ?? step.id,
      subjectKey: step.id,
    });
    const already = byKey.get(sourceEventKey);
    if (already) return already;

    const evidence: EvidenceRef[] = step.evidence;
    return {
      id: `action:${step.id}`,
      organizationId,
      ...(input.answerId ? { answerId: input.answerId } : {}),
      ...(input.planId ? { planId: input.planId } : {}),
      graphId: graph.id,
      proposalId: step.id,
      owningApp: step.owningApp,
      operation: step.operation ?? step.id,
      ...(step.payload ? { payload: step.payload } : {}),
      intent: step.title,
      whyItMatters: whyFrom(step),
      evidence,
      dependsOn: step.dependsOn.map((id) => `action:${id}`),
      consequence,
      requiresApproval: needsApproval(consequence),
      requiredCapability: step.requiredCapability,
      route: step.route,
      routeLabel: step.routeLabel,
      boundary: { willDo: step.willDo, willNotDo: step.willNotDo },
      expectedSignal: { statement: step.expectedSignal, observedIn: step.owningApp },
      sourceEventKey,
      status: "proposed" as ActionLifecycleState,
      createdAt: now,
    } satisfies ControlledAction;
  });
}

/* --------------------------------------------------------------- decisions */

export interface ApprovalDecision {
  actionId: string;
  kind: ApprovalDecisionKind;
  reason?: string;
}

const DECISION_STATE: Record<ApprovalDecisionKind, ActionLifecycleState> = {
  approve: "approved",
  hold: "held",
  reject: "rejected",
  withdraw: "withdrawn",
};

export interface DecisionContext {
  by: { id: string; label: string };
  at: string;
  /** Fails closed: without `conductor.approve` no decision is recorded. */
  canApprove: boolean;
}

/**
 * Apply one person's decisions to the queue.
 *
 * Selective by construction: only the named actions move, every other action
 * is returned untouched, and an illegal move throws rather than silently
 * settling into a state the lifecycle does not allow.
 */
export function decideActions(
  actions: ControlledAction[],
  decisions: ApprovalDecision[],
  context: DecisionContext,
): ControlledAction[] {
  if (!context.canApprove) {
    throw new Error("Your role cannot approve, hold or reject Conductor actions.");
  }
  const map = new Map(decisions.map((decision) => [decision.actionId, decision]));

  return actions.map((action) => {
    const decision = map.get(action.id);
    if (!decision) return action;

    if (decision.kind !== "approve" && !decision.reason?.trim()) {
      throw new Error("Holding, rejecting or withdrawing an action needs a reason.");
    }
    if (!action.requiresApproval && decision.kind === "approve") {
      /* Look-only work is never "approved": there is nothing to allow. */
      return action;
    }

    const next = DECISION_STATE[decision.kind];
    assertTransition(action.status, next);

    return {
      ...action,
      status: next,
      approval: {
        kind: decision.kind,
        by: context.by,
        at: context.at,
        ...(decision.reason ? { reason: decision.reason.trim() } : {}),
      },
    };
  });
}

/** Approve every action still awaiting a decision. Held/rejected stay put. */
export function approveAll(
  actions: ControlledAction[],
  context: DecisionContext,
): ControlledAction[] {
  return decideActions(
    actions,
    actions
      .filter((action) => action.status === "proposed" && action.requiresApproval)
      .map((action) => ({ actionId: action.id, kind: "approve" as const })),
    context,
  );
}

/* ---------------------------------------------------------------- routing */

/** A prerequisite counts as satisfied once it has reached the owning room. */
const DEPENDENCY_SATISFIED: ActionLifecycleState[] = [
  "routed",
  "accepted",
  "executing",
  "completed",
  "measured",
];

export interface RoutabilityInput {
  action: ControlledAction;
  actions: ControlledAction[];
  adapters: RoomAdapter[];
  access: { can: (permission: string) => boolean };
}

/**
 * May this action be routed right now? Every "no" names itself, because an
 * unexplained refusal is indistinguishable from a bug.
 */
export function routability(input: RoutabilityInput): RoutingVerdict {
  const { action, actions, adapters, access } = input;

  if (action.status === "routed" || DEPENDENCY_SATISFIED.includes(action.status)) {
    return {
      routable: false,
      because: "This action has already been handed to the owning room.",
      refusal: "already_routed",
    };
  }
  if (action.requiresApproval && action.status !== "approved") {
    return {
      routable: false,
      because: "Nothing is routed without your approval.",
      refusal: "not_approved",
    };
  }
  if (!isRoutableConsequence(action.consequence)) {
    return {
      routable: false,
      because:
        action.consequence === "informational"
          ? "This one only opens a view. There is nothing to route."
          : "Work that leaves the building is never routed automatically. A person does it.",
      refusal: "out_of_scope",
    };
  }

  const byId = new Map(actions.map((row) => [row.id, row]));
  for (const dependencyId of action.dependsOn) {
    const dependency = byId.get(dependencyId);
    if (!dependency) continue;
    if (!DEPENDENCY_SATISFIED.includes(dependency.status)) {
      return {
        routable: false,
        because: `Blocked by "${dependency.intent}", which is ${dependency.status}.`,
        refusal: "blocked_by_dependency",
      };
    }
  }

  if (!access.can("conductor.execute")) {
    return {
      routable: false,
      because: "Your role may not route approved actions to rooms.",
      refusal: "not_permitted",
    };
  }

  const adapter = adapterFor(adapters, action);
  if (!adapter) {
    return {
      routable: false,
      because: `${action.owningApp} exposes no safe service for "${action.operation}" yet, so this stays approved but not routable.`,
      refusal: "no_adapter",
    };
  }

  return adapter.canRoute(action, access);
}

/** The adapter that owns this action, if any. Room ownership is enforced. */
export function adapterFor(
  adapters: RoomAdapter[],
  action: ControlledAction,
): RoomAdapter | undefined {
  return adapters.find(
    (adapter) => adapter.room === action.owningApp && adapter.supports(action.operation),
  );
}

/** The approved actions that may move, in dependency order. */
export function routingQueue(
  actions: ControlledAction[],
  adapters: RoomAdapter[],
  access: { can: (permission: string) => boolean },
): ControlledAction[] {
  return actions.filter(
    (action) => routability({ action, actions, adapters, access }).routable,
  );
}

/* -------------------------------------------------------- control response */

/**
 * What the Conductor is allowed to say about its own control state.
 * Never the word "done" unless an owning room reported completion.
 */
export function controlResponse(
  actions: ControlledAction[],
  adapters: RoomAdapter[],
  access: { can: (permission: string) => boolean },
): ControlResponse {
  const readyToApprove: ControlledAction[] = [];
  const approved: ControlledAction[] = [];
  const routed: ControlledAction[] = [];
  const blocked: { action: ControlledAction; because: string }[] = [];
  const notRoutable: { action: ControlledAction; because: string }[] = [];
  const informational: ControlledAction[] = [];
  const held: ControlledAction[] = [];
  const rejected: ControlledAction[] = [];

  for (const action of actions) {
    if (action.consequence === "informational") {
      informational.push(action);
      continue;
    }
    if (action.status === "held") {
      held.push(action);
      continue;
    }
    if (action.status === "rejected" || action.status === "withdrawn") {
      rejected.push(action);
      continue;
    }
    if (DEPENDENCY_SATISFIED.includes(action.status)) {
      routed.push(action);
      continue;
    }
    if (action.status === "proposed") {
      readyToApprove.push(action);
      continue;
    }
    const verdict = routability({ action, actions, adapters, access });
    if (verdict.routable) {
      approved.push(action);
    } else if (verdict.refusal === "blocked_by_dependency") {
      blocked.push({ action, because: verdict.because });
    } else {
      notRoutable.push({ action, because: verdict.because });
    }
  }

  const parts: string[] = [];
  if (readyToApprove.length > 0) parts.push(`${readyToApprove.length} waiting for your decision`);
  if (approved.length > 0) parts.push(`${approved.length} approved and ready to route`);
  if (routed.length > 0) parts.push(`${routed.length} already with the owning room`);
  if (blocked.length > 0) parts.push(`${blocked.length} blocked by a prerequisite`);
  if (notRoutable.length > 0) parts.push(`${notRoutable.length} approved but not routable`);
  if (held.length > 0) parts.push(`${held.length} held`);
  if (rejected.length > 0) parts.push(`${rejected.length} closed`);

  return {
    readyToApprove,
    approved,
    routed,
    blocked,
    notRoutable,
    informational,
    held,
    rejected,
    statement:
      parts.length === 0
        ? "Nothing is under control right now — there is no prepared action to decide on."
        : `${parts.join(", ")}. Routing hands work over; the owning room reports completion.`,
  };
}

/* ------------------------------------------------------------- outcome hook */

/**
 * Attach what was actually observed. The link back to the recommendation and
 * the approval survives, so a later pass can learn from what worked.
 */
export function attachOutcome(
  action: ControlledAction,
  outcome: ActionOutcome,
): ControlledAction {
  if (action.status !== "completed") {
    throw new Error("An outcome can only be measured once the owning room reported completion.");
  }
  assertTransition(action.status, "measured");
  return { ...action, status: "measured", outcome };
}

/** The context an adapter needs, built from an approval. Never anonymous. */
export function adapterContext(
  action: ControlledAction,
  actor: { id: string; label: string },
  now: string,
): AdapterContext {
  const approvedBy = action.approval?.by ?? actor;
  return { organizationId: action.organizationId, actor, approvedBy, now };
}

/** Convenience for tests and UI: the permission the owning room will demand. */
export function requiredRoomPermission(action: ControlledAction): string {
  return (
    action.requiredCapability ||
    actionPermission({ appId: action.owningApp, operation: action.operation })
  );
}
