/**
 * Trust Tai OS — the Conductor's control contract (V2).
 *
 * V1 could reason and prepare. V2 adds the only thing a command layer may
 * legitimately add: a governed way for a person to approve part of a prepared
 * plan, and a typed boundary through which the approved part is handed to the
 * room that owns it.
 *
 * The laws, encoded rather than hoped for:
 *
 *   - **Approval is not execution.** An approved action is permission, not a
 *     result. It sits in `approved` until something routes it.
 *   - **Routing is not completion.** A successful route reaches `routed`.
 *     Only the owning room may take it further.
 *   - **No adapter, no execution claim.** An action whose room exposes no safe
 *     service boundary becomes approved-but-not-routable, with the missing
 *     capability named. Nothing pretends.
 *   - **Every controlled action carries** an owning room, provenance, a
 *     dependency set, an idempotency key and an expected signal.
 *   - **Governance is not business truth.** These objects describe the
 *     Conductor's own control loop. They copy no prospect, relationship,
 *     roadmap, project or asset.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { Permission } from "./access";

/* ------------------------------------------------------------- lifecycle */

/**
 * The lifecycle of one controlled action.
 *
 * The happy path is `proposed → approved → routed → accepted → executing →
 * completed → measured`. `held`, `rejected`, `withdrawn` and `failed` are the
 * honest interruptions.
 */
export type ActionLifecycleState =
  | "proposed"
  | "approved"
  | "held"
  | "rejected"
  | "routed"
  | "accepted"
  | "executing"
  | "completed"
  | "failed"
  | "withdrawn"
  | "measured";

export const LIFECYCLE_LABEL: Record<ActionLifecycleState, string> = {
  proposed: "Awaiting your decision",
  approved: "Approved — not yet routed",
  held: "Held",
  rejected: "Rejected",
  routed: "Routed to the owning room",
  accepted: "Accepted by the owning room",
  executing: "Being carried out",
  completed: "Completed by the owning room",
  failed: "Routing failed",
  withdrawn: "Withdrawn",
  measured: "Measured against its signal",
};

/**
 * Every legal move. Anything absent here is refused, so no code path can
 * quietly promote an action from `approved` to `completed`.
 */
export const ALLOWED_TRANSITIONS: Record<ActionLifecycleState, ActionLifecycleState[]> = {
  proposed: ["approved", "held", "rejected", "withdrawn"],
  approved: ["routed", "held", "rejected", "withdrawn", "failed"],
  held: ["approved", "rejected", "withdrawn"],
  rejected: [],
  routed: ["accepted", "failed", "withdrawn"],
  accepted: ["executing", "completed", "failed", "withdrawn"],
  executing: ["completed", "failed"],
  completed: ["measured"],
  failed: ["approved", "withdrawn"],
  withdrawn: [],
  measured: [],
};

export const TERMINAL_STATES: ActionLifecycleState[] = ["rejected", "withdrawn", "measured"];

export function canTransition(from: ActionLifecycleState, to: ActionLifecycleState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Refuse an illegal move loudly. Fails closed. */
export function assertTransition(from: ActionLifecycleState, to: ActionLifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `An action cannot move from ${LIFECYCLE_LABEL[from].toLowerCase()} to ${LIFECYCLE_LABEL[to].toLowerCase()}.`,
    );
  }
}

/** States in which nothing has been handed to any room yet. */
export function isPreRouting(state: ActionLifecycleState): boolean {
  return state === "proposed" || state === "approved" || state === "held" || state === "failed";
}

/* ----------------------------------------------------------- consequence */

/** How much of the world an action touches. Drives whether approval is needed. */
export type ConsequenceClass =
  /** Opens a view for a person. Changes nothing anywhere. */
  | "informational"
  /** Writes something internal and unsent: a draft, a prepared brief. */
  | "internal_preparation"
  /** Changes a room's own state, reversibly, inside the suite. */
  | "internal_change"
  /** Leaves the building: a message, a publication, money, a commitment. */
  | "external";

export const CONSEQUENCE_LABEL: Record<ConsequenceClass, string> = {
  informational: "Look only",
  internal_preparation: "Prepares something internal, unsent",
  internal_change: "Changes internal state, reversibly",
  external: "Leaves the building",
};

/** Only "look only" work is exempt from approval. Everything else is gated. */
export function needsApproval(consequence: ConsequenceClass): boolean {
  return consequence !== "informational";
}

/**
 * External consequence is deliberately out of scope for V2: no message is
 * sent, nothing is published, no money moves, no commitment changes.
 */
export function isRoutableConsequence(consequence: ConsequenceClass): boolean {
  return consequence === "internal_preparation" || consequence === "internal_change";
}

/* ------------------------------------------------------ controlled action */

export type ApprovalDecisionKind = "approve" | "hold" | "reject" | "withdraw";

export interface ApprovalRecord {
  kind: ApprovalDecisionKind;
  by: { id: ID; label: string };
  at: ISODateTime;
  /** Required for hold, reject and withdraw. Optional on approve. */
  reason?: string;
}

/** What should become observably true, and where we would see it. */
export interface ExpectedSignal {
  statement: string;
  /** A vital sign key when the action is supposed to move one. */
  vitalKey?: string;
  /** The room whose record would show it. */
  observedIn: string;
}

/** Whether the action actually helped. Attached later, never assumed. */
export interface ActionOutcome {
  verdict: "worked" | "no_change" | "worse" | "unknown";
  statement: string;
  observedAt: ISODateTime;
  evidence: EvidenceRef[];
}

/**
 * One governed action.
 *
 * It is a control object, not domain truth: it references the room that owns
 * the change and never stores a copy of that room's record.
 */
export interface ControlledAction {
  id: ID;
  organizationId: ID;
  /** The plan / answer / graph the action descends from. References only. */
  planId?: ID;
  answerId?: ID;
  graphId?: ID;
  /** The intelligence-layer proposal and recommendation it came from. */
  proposalId?: ID;
  recommendationId?: ID;
  /** The room whose service must carry this out. Never "conductor". */
  owningApp: string;
  /** An operation the owning room already performs, e.g. "comms.draft_reply". */
  operation: string;
  /** References the owning room's service needs. Never a copy of room truth. */
  payload?: Record<string, unknown>;
  /** Plain language: what a person is being asked to allow. */
  intent: string;
  /** Why it matters, in one sentence, carried from the evidence. */
  whyItMatters: string;
  evidence: EvidenceRef[];
  /** Ids of actions that must reach a routed-or-better state first. */
  dependsOn: ID[];
  consequence: ConsequenceClass;
  requiresApproval: boolean;
  /** The permission the owning room requires of the person. */
  requiredCapability: Permission | string;
  route: string;
  routeLabel: string;
  /** The execution boundary. Both lists are non-empty by construction. */
  boundary: { willDo: string[]; willNotDo: string[] };
  expectedSignal: ExpectedSignal;
  /** Stable across retries: the same action never routes twice. */
  sourceEventKey: string;
  status: ActionLifecycleState;
  approval?: ApprovalRecord;
  routedAt?: ISODateTime;
  receiptId?: ID;
  outcome?: ActionOutcome;
  createdAt: ISODateTime;
}

/* -------------------------------------------------------------- receipts */

export type ReceiptStatus = "routed" | "refused" | "failed";

/**
 * What actually happened when an approved action was handed over. A receipt
 * is written whether the handover succeeded, was refused, or failed — silence
 * is never an outcome.
 */
export interface ExecutionReceipt {
  id: ID;
  organizationId: ID;
  actionId: ID;
  owningApp: string;
  /** The adapter and the room service it called. */
  adapterId: string;
  boundaryCrossed: string;
  routedAt: ISODateTime;
  approvedBy: { id: ID; label: string };
  routedBy: { id: ID; label: string };
  sourceEventKey: string;
  status: ReceiptStatus;
  /** The reference the owning room created, when it created one. */
  result?: { reference?: string; label: string };
  failure?: string;
  /** The state the action is in *after* this receipt. Never "completed". */
  resultingState: ActionLifecycleState;
}

/* --------------------------------------------------------- adapter contract */

export type RoutingRefusal =
  | "not_approved"
  | "blocked_by_dependency"
  | "no_adapter"
  | "missing_input"
  | "not_permitted"
  | "already_routed"
  | "out_of_scope";

export interface RoutingVerdict {
  routable: boolean;
  because: string;
  refusal?: RoutingRefusal;
}

export interface AdapterPreparation {
  ready: boolean;
  because: string;
  /** References the owning room's service needs. Never business truth itself. */
  payload?: Record<string, unknown>;
}

export interface AdapterContext {
  organizationId: ID;
  actor: { id: ID; label: string };
  /** The person whose approval authorises the routing. */
  approvedBy: { id: ID; label: string };
  now?: ISODateTime;
}

/**
 * The only way the Conductor may reach another room.
 *
 * An adapter calls the owning room's existing service, with that room's own
 * permission still enforced inside it. There is deliberately no generic
 * "write table" escape hatch.
 */
export interface RoomAdapter {
  id: string;
  /** The owning room. An adapter may never act for another. */
  room: string;
  /** What this adapter can carry, named as room operations. */
  operations: string[];
  /** Human sentence describing which service boundary it crosses. */
  boundary: string;
  supports(operation: string): boolean;
  canRoute(action: ControlledAction, access: { can: (p: string) => boolean }): RoutingVerdict;
  prepare(action: ControlledAction, context: AdapterContext): Promise<AdapterPreparation>;
  route(action: ControlledAction, context: AdapterContext): Promise<ExecutionReceipt>;
  readStatus(action: ControlledAction, context: AdapterContext): Promise<ActionLifecycleState>;
}

/** A stable idempotency key for one action in one organization. */
export function controlSourceEventKey(input: {
  organizationId: ID;
  owningApp: string;
  operation: string;
  subjectKey: string;
}): string {
  return `conductor.action:${input.organizationId}:${input.owningApp}:${input.operation}:${input.subjectKey}`;
}

/* ------------------------------------------------- control response shape */

/** What the Conductor is allowed to say about its own control state. */
export interface ControlResponse {
  readyToApprove: ControlledAction[];
  approved: ControlledAction[];
  routed: ControlledAction[];
  blocked: { action: ControlledAction; because: string }[];
  notRoutable: { action: ControlledAction; because: string }[];
  informational: ControlledAction[];
  held: ControlledAction[];
  rejected: ControlledAction[];
  /** One honest sentence. Never says "done". */
  statement: string;
}
