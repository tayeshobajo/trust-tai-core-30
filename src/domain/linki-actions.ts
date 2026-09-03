/**
 * Governed LinkedIn actions, the P2 execution contract.
 *
 * Law (integration brief + Tai's 2026-08-27 authorization):
 *   - NO autonomous sending. Every action starts `pending_tai_approval` and
 *     only a human click (Tai) moves it to `approved`, and only the human who
 *     approved may trigger execution. This module is plumbing; the boundary
 *     is the human.
 *   - Linki is transport, never the brain. Core owns identity (the canonical
 *     prospect/person/contact linkage on every row); Comms owns the draft
 *     (`draft_body` arrives from Comms and is never generated here).
 *   - One person. One memory. The action references the canonical contact
 *     row, there is no parallel Linki identity model.
 *   - A failed action is TERMINAL. Retrying means a new action row that
 *     references the original via `parent_action_id`; nothing is re-executed
 *     in place.
 */

export const LINKI_ACTION_TYPES = ["connection_request", "message"] as const;
export type LinkiActionType = (typeof LINKI_ACTION_TYPES)[number];

export const LINKI_ACTION_STATUSES = [
  "pending_tai_approval",
  "approved",
  "executing",
  "executed",
  "failed",
  "verified",
] as const;
export type LinkiActionStatus = (typeof LINKI_ACTION_STATUSES)[number];

/** Statuses that count against daily caps. `failed` is excluded. */
export const CAP_COUNTED_STATUSES: readonly LinkiActionStatus[] = [
  "pending_tai_approval",
  "approved",
  "executing",
  "executed",
  "verified",
];

/** Terminal states. No transition leaves these. */
export const TERMINAL_LINKI_ACTION_STATUSES: readonly LinkiActionStatus[] = [
  "failed",
  "verified",
];

/**
 * The one legal state machine. Everything else is rejected:
 *
 *   pending_tai_approval → approved          (the human approval boundary)
 *   approved             → executing         (only by the approver)
 *   executing            → executed | failed (transport outcome)
 *   executed             → verified          (human/observation confirms)
 *   failed               → (terminal; retry = NEW row with parent_action_id)
 *   verified             → (terminal)
 */
export const LINKI_ACTION_TRANSITIONS: Record<LinkiActionStatus, readonly LinkiActionStatus[]> =
  {
    pending_tai_approval: ["approved"],
    approved: ["executing"],
    executing: ["executed", "failed"],
    executed: ["verified"],
    failed: [],
    verified: [],
  };

export function canTransition(before: LinkiActionStatus, after: LinkiActionStatus): boolean {
  const allowed = LINKI_ACTION_TRANSITIONS[before];
  return Array.isArray(allowed) && allowed.includes(after);
}

export function isLinkiActionStatus(value: unknown): value is LinkiActionStatus {
  return (
    typeof value === "string" && (LINKI_ACTION_STATUSES as readonly string[]).includes(value)
  );
}

export function isLinkiActionType(value: unknown): value is LinkiActionType {
  return (
    typeof value === "string" && (LINKI_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ */
/* Errors, typed so the HTTP route can map them without guessing.     */
/* ------------------------------------------------------------------ */

export type LinkiActionErrorCode =
  | "validation"
  | "not_found"
  | "illegal_transition"
  | "forbidden"
  | "kill_switch"
  | "cap_exceeded"
  | "send_failed";

export class LinkiActionError extends Error {
  constructor(
    public readonly code: LinkiActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LinkiActionError";
  }
}

/** HTTP status for each failure mode. Kill switch is a hard 503. */
export function linkiActionErrorStatus(code: LinkiActionErrorCode): number {
  switch (code) {
    case "kill_switch":
      return 503;
    case "not_found":
      return 404;
    case "forbidden":
      return 403;
    case "cap_exceeded":
      return 429;
    case "illegal_transition":
      return 409;
    case "send_failed":
      return 502;
    case "validation":
      return 400;
  }
}

/* ------------------------------------------------------------------ */
/* Domain model (camelCase), the typed shape of one governed action.  */
/* ------------------------------------------------------------------ */

/** What Linki handed back after a real send. Stored verbatim on the row. */
export interface LinkiExecutionReceipt {
  provider: "linki";
  /** Linki's run id, the auditable reference inside the transport. */
  runId: string;
  sentAt: string;
  response: Record<string, unknown> | null;
}

export interface ApprovedLinkedInAction {
  id: string;
  organizationId: string;
  prospectId: string;
  /** The canonical person (contacts row) this action is about. */
  personId: string;
  /** The canonical contact record (same contacts table, one identity). */
  contactId: string;
  actionType: LinkiActionType;
  /** The Comms-owned draft. Never generated here, never edited here. */
  draftBody: string;
  /** Thread/conversation reference + the LinkedIn route snapshot. */
  channelContext: Record<string, unknown>;
  status: LinkiActionStatus;
  idempotencyKey: string;
  executionReceipt: LinkiExecutionReceipt | null;
  failureReason: string | null;
  createdBy: string;
  approvedAt: string | null;
  approvedBy: string | null;
  executedAt: string | null;
  /** Set when this row is a retry of a terminal-failed original. */
  parentActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Environment switches, fail closed by default.                      */
/* ------------------------------------------------------------------ */

type Env = Record<string, string | undefined>;

export const DEFAULT_LINKI_DAILY_MSG_CAP = 10;
export const DEFAULT_LINKI_DAILY_CONN_CAP = 5;

/**
 * The execution kill switch. OFF unless EXPLICITLY `"true"`, unset, empty,
 * "1", "yes", everything else means disabled. Default false everywhere.
 */
export function linkiExecutionEnabled(env: Env = process.env): boolean {
  return env["LINKI_EXECUTION_ENABLED"] === "true";
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed: fallback;
}

/** Daily cap for one action type. Messages default 10, connections 5. */
export function linkiDailyCap(env: Env, actionType: LinkiActionType): number {
  return actionType === "message"
    ? positiveInt(env, "LINKI_DAILY_MSG_CAP", DEFAULT_LINKI_DAILY_MSG_CAP)
: positiveInt(env, "LINKI_DAILY_CONN_CAP", DEFAULT_LINKI_DAILY_CONN_CAP);
}
