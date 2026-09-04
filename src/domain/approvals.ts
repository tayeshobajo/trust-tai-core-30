/**
 * Trust Tai OS, the Approvals contract.
 *
 * Approvals is the human judgment layer for the whole suite. It is not a
 * business room and it owns no business truth. It owns exactly one thing: the
 * decision, and the provenance of that decision.
 *
 * The laws, encoded rather than hoped for:
 *
 *   - **Agents prepare. Humans approve. Execution happens after approval.**
 *   - **Source apps own the work. Approvals owns the decision.** An approval
 *     record holds references and, where audit genuinely needs it, a small
 *     immutable snapshot. It never becomes a second copy of a prospect,
 *     relationship, roadmap or post.
 *   - **Approved is not executed. Executed is not verified.** Three distinct
 *     states, never collapsed, never inferred from each other.
 *   - **AI handles volume. Humans handle exceptions.** A batch is one decision
 *     object with child items, and the exceptions are what surfaces.
 *   - **Nothing skips the human.** A governed request cannot reach `executed`
 *     without passing through `approved` first, by state machine, not by
 *     convention.
 *
 * This file is pure. It touches no database and no network so every rule here
 * is testable on its own.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { Permission } from "./access";

/* ------------------------------------------------------------ source apps */

/** The room that prepared the work and still owns it. */
export type ApprovalSourceApp =
  | "scout"
  | "comms"
  | "roadmap"
  | "website"
  | "projects"
  | "ops"
  | "studio"
  | "content";

export const SOURCE_APP_LABEL: Record<ApprovalSourceApp, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  website: "Website",
  projects: "Projects",
  ops: "Ops",
  studio: "Studio",
  content: "Content",
};

/* -------------------------------------------------------------- categories */

/**
 * What kind of judgment this is. Categories are how a person navigates;
 * source apps are how the work gets home afterwards.
 */
export type ApprovalCategory =
  | "marketing"
  | "communication"
  | "qualification"
  | "strategy"
  | "delivery"
  | "creative"
  | "operations";

/** The category bar at the top of the room. `all` is a view, not a category. */
export type CategoryTab = "all" | "marketing" | "comms" | "scout" | "roadmap" | "delivery";

export const CATEGORY_TAB_LABEL: Record<CategoryTab, string> = {
  all: "All",
  marketing: "Marketing",
  comms: "Comms",
  scout: "Scout",
  roadmap: "Roadmap",
  delivery: "Delivery",
};

/**
 * Which tab a request appears under.
 *
 * Marketing aggregates the content engine, website marketing content, campaign
 * assets and Studio creative. Delivery aggregates Projects, Website
 * implementation and Ops. This mapping is the only place that knowledge lives.
 */
export function tabFor(request: {
  category: ApprovalCategory;
  sourceApp: ApprovalSourceApp;
}): Exclude<CategoryTab, "all"> {
  if (request.sourceApp === "comms") return "comms";
  if (request.sourceApp === "scout") return "scout";
  if (request.sourceApp === "roadmap") return "roadmap";
  if (request.category === "marketing" || request.category === "creative") return "marketing";
  if (request.category === "strategy") return "roadmap";
  if (request.category === "communication") return "comms";
  if (request.category === "qualification") return "scout";
  return "delivery";
}

export function inTab(
  request: { category: ApprovalCategory; sourceApp: ApprovalSourceApp },
  tab: CategoryTab,
): boolean {
  return tab === "all" || tabFor(request) === tab;
}

/* ------------------------------------------------------------------ status */

/**
 * The decision lifecycle.
 *
 * `draft` never appears here: a draft is still in the source app. A request
 * exists in Approvals only once it has been submitted.
 */
export type ApprovalStatus =
  | "needs_review"
  | "needs_context"
  | "ready"
  | "revision_requested"
  | "approved"
  | "rejected"
  | "queued"
  | "executed"
  | "verified";

export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  needs_review: "Needs review",
  needs_context: "Needs context",
  ready: "Ready to approve",
  revision_requested: "Revision requested",
  approved: "Approved",
  rejected: "Not now",
  queued: "Queued",
  executed: "Executed",
  verified: "Verified",
};

/** Plain-language meaning, shown wherever a state could be misread. */
export const STATUS_MEANING: Record<ApprovalStatus, string> = {
  needs_review: "Waiting on your judgment.",
  needs_context: "Cannot be safely recommended yet.",
  ready: "The source app finished its own checks.",
  revision_requested: "Returned to the source app for another pass.",
  approved: "You authorised it. Nothing has happened yet.",
  rejected: "Closed without action.",
  queued: "Handed to the downstream path, waiting to run.",
  executed: "The action happened.",
  verified: "The intended outcome was confirmed.",
};

/**
 * Every legal move. Anything absent is refused, so no code path can promote a
 * request from `ready` straight to `executed` without a human decision.
 */
export const ALLOWED_APPROVAL_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  needs_review: ["needs_context", "ready", "approved", "rejected", "revision_requested"],
  needs_context: ["needs_review", "ready", "rejected", "revision_requested"],
  ready: ["needs_review", "needs_context", "approved", "rejected", "revision_requested"],
  revision_requested: ["needs_review", "needs_context", "ready", "rejected"],
  approved: ["queued", "executed", "rejected"],
  queued: ["executed", "rejected"],
  executed: ["verified"],
  verified: [],
  rejected: [],
};

export const OPEN_STATUSES: ApprovalStatus[] = [
  "needs_review",
  "needs_context",
  "ready",
  "revision_requested",
];

export const CLOSED_STATUSES: ApprovalStatus[] = ["rejected", "verified"];

export function canApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return ALLOWED_APPROVAL_TRANSITIONS[from].includes(to);
}

/** Refuse an illegal move loudly. Fails closed. */
export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  if (from === to) return;
  if (!canApprovalTransition(from, to)) {
    throw new Error(
      `An approval cannot move from "${STATUS_LABEL[from]}" to "${STATUS_LABEL[to]}".`,
    );
  }
}

/** True once a human has authorised the work, whatever happened afterwards. */
export function isHumanAuthorised(status: ApprovalStatus): boolean {
  return status === "approved" || status === "queued" || status === "executed" || status === "verified";
}

/* ------------------------------------------------------------ board states */

/** The four familiar queue columns. Terminal states live in history. */
export type BoardColumn = "needs_review" | "needs_context" | "ready" | "approved";

export const BOARD_COLUMNS: BoardColumn[] = ["needs_review", "needs_context", "ready", "approved"];

export const BOARD_COLUMN_LABEL: Record<BoardColumn, string> = {
  needs_review: "Needs review",
  needs_context: "Needs context",
  ready: "Ready to approve",
  approved: "Approved / queued",
};

/** Which column a request sits in, or null when it belongs in history. */
export function columnFor(status: ApprovalStatus): BoardColumn | null {
  switch (status) {
    case "needs_review":
    case "revision_requested":
      return "needs_review";
    case "needs_context":
      return "needs_context";
    case "ready":
      return "ready";
    case "approved":
    case "queued":
    case "executed":
      return "approved";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------- types */

/** The approval types with a registered renderer in V1. */
export type ApprovalType =
  | "comms_draft"
  | "scout_relationship"
  | "blog_batch"
  | "roadmap_change"
  | "delivery_change";

export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  comms_draft: "Message draft",
  scout_relationship: "Relationship development",
  blog_batch: "Content batch",
  roadmap_change: "Roadmap change",
  delivery_change: "Delivery change",
};

/* ------------------------------------------------------------- the request */

export type SubmitterKind = "agent" | "user";

export interface ApprovalSubmitter {
  type: SubmitterKind;
  id: ID;
  label: string;
}

export type ApprovalDecisionKind =
  | "approve"
  | "reject"
  | "request_revision";

export interface ApprovalDecision {
  decision: ApprovalDecisionKind;
  decidedBy: { id: ID; label: string };
  decidedAt: ISODateTime;
  reason?: string;
  /** Child item ids authorised, when only part of a batch was approved. */
  itemIds?: ID[];
}

export type UrgencyLevel = "now" | "soon" | "whenever";
export type ImpactLevel = "high" | "medium" | "low";

export const URGENCY_LABEL: Record<UrgencyLevel, string> = {
  now: "Needs a decision now",
  soon: "Soon",
  whenever: "No deadline",
};

export const IMPACT_LABEL: Record<ImpactLevel, string> = {
  high: "High impact",
  medium: "Medium impact",
  low: "Low impact",
};

/** A pointer into the owning room. Never a copy of the entity itself. */
export interface SourceEntityRef {
  type: string;
  id: ID;
  label?: string;
}

/**
 * One decision waiting for a person.
 *
 * `payload` is source-specific and read only by that type's renderer. The
 * universal shell reads nothing from it.
 */
export interface ApprovalRequest {
  id: ID;
  organizationId: ID;
  sourceApp: ApprovalSourceApp;
  category: ApprovalCategory;
  approvalType: ApprovalType;
  title: string;
  summary: string;
  /** Plain language: why this crossed the line into human judgment. */
  whyItNeedsYou: string;
  status: ApprovalStatus;
  urgency: UrgencyLevel;
  impact: ImpactLevel;
  sourceEntity: SourceEntityRef;
  submittedBy: ApprovalSubmitter;
  /** Stable identity of the source state. Two submits of it never make two rows. */
  sourceKey: string;
  /** Which permission the person needs in the owning room, on top of approval authority. */
  requiredCapability: Permission;
  /** What Approvals will and will not do once you approve. */
  boundary: { willDo: string[]; willNotDo: string[] };
  evidence: EvidenceRef[];
  payload: Record<string, unknown>;
  batch?: BatchSummary;
  decision?: ApprovalDecision;
  /** Increments each time the source app resubmits after a revision request. */
  revision: number;
  /** Set once a downstream adapter accepted the decision. */
  downstream?: DownstreamResult;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* --------------------------------------------------------------- batching */

export interface BatchSummary {
  total: number;
  ready: number;
  exceptions: number;
  failed: number;
  approved: number;
  executed: number;
}

export type ApprovalItemState =
  | "ready"
  | "exception"
  | "failed"
  | "approved"
  | "rejected"
  | "executed";

export const ITEM_STATE_LABEL: Record<ApprovalItemState, string> = {
  ready: "Ready",
  exception: "Needs review",
  failed: "Failed",
  approved: "Approved",
  rejected: "Not now",
  executed: "Published",
};

/**
 * Why a child item needs a person. Only genuine judgment calls belong here:
 * anything an agent can settle should never become an exception.
 */
export type ExceptionReason =
  | "low_confidence"
  | "conflicting_evidence"
  | "voice_mismatch"
  | "weak_hit"
  | "unusual_commitment"
  | "irreversible"
  | "identity_ambiguous";

export const EXCEPTION_LABEL: Record<ExceptionReason, string> = {
  low_confidence: "Confidence is low",
  conflicting_evidence: "Evidence conflicts",
  voice_mismatch: "Voice does not match",
  weak_hit: "Weak against the threshold",
  unusual_commitment: "Makes an unusual commitment",
  irreversible: "Hard to undo",
  identity_ambiguous: "Who this is about is unclear",
};

/** One member of a batch. Small on purpose: the source app owns the artefact. */
export interface ApprovalItem {
  id: ID;
  organizationId: ID;
  requestId: ID;
  /** Stable identity within the batch, so a resubmit updates rather than doubles. */
  itemKey: string;
  title: string;
  state: ApprovalItemState;
  exceptionReasons: ExceptionReason[];
  /** Small type-specific facts: HIT score, image state, SEO state, and so on. */
  facts: Record<string, unknown>;
  sourceEntity?: SourceEntityRef;
  position: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export function summariseBatch(items: ApprovalItem[]): BatchSummary {
  const count = (state: ApprovalItemState) => items.filter((item) => item.state === state).length;
  return {
    total: items.length,
    ready: count("ready"),
    exceptions: count("exception"),
    failed: count("failed"),
    approved: count("approved"),
    executed: count("executed"),
  };
}

/** The subset a person may authorise in one move. Never the exceptions. */
export function readyItemIds(items: ApprovalItem[]): ID[] {
  return items.filter((item) => item.state === "ready").map((item) => item.id);
}

/* ---------------------------------------------------------- downstream */

export type DownstreamState = "pending" | "queued" | "accepted" | "unavailable" | "failed";

/**
 * What happened after the decision left Approvals.
 *
 * `unavailable` is an honest outcome, not a failure: the decision is recorded
 * and the execution path does not exist yet. Nothing pretends otherwise.
 */
export interface DownstreamResult {
  state: DownstreamState;
  adapterId: string;
  because: string;
  reference?: string;
  at: ISODateTime;
}

/* ----------------------------------------------------------------- notes */

export type ApprovalEventKind =
  | "submitted"
  | "resubmitted"
  | "note"
  | "decision"
  | "state_changed"
  | "downstream";

/** Append-only. A note always carries who wrote it and when. */
export interface ApprovalEvent {
  id: ID;
  organizationId: ID;
  requestId: ID;
  kind: ApprovalEventKind;
  body: string;
  actor: { type: SubmitterKind | "system"; id: ID; label: string };
  metadata: Record<string, unknown>;
  createdAt: ISODateTime;
}

/* ----------------------------------------------------------- decision acts */

export type ApprovalActionId =
  | "approve"
  | "approve_and_queue"
  | "approve_and_send"
  | "approve_and_execute"
  | "approve_ready"
  | "request_revision"
  | "reject"
  | "edit_before_approval"
  | "open_source"
  | "explain"
  | "add_note";

export interface ApprovalAction {
  id: ApprovalActionId;
  label: string;
  tone: "primary" | "secondary" | "quiet";
  /** True when the act authorises work. Gated on approval authority. */
  authorising: boolean;
}

const ACTION: Record<ApprovalActionId, ApprovalAction> = {
  approve: { id: "approve", label: "Approve", tone: "primary", authorising: true },
  approve_and_queue: {
    id: "approve_and_queue",
    label: "Approve and queue",
    tone: "primary",
    authorising: true,
  },
  approve_and_send: {
    id: "approve_and_send",
    label: "Approve for sending",
    tone: "primary",
    authorising: true,
  },
  approve_and_execute: {
    id: "approve_and_execute",
    label: "Approve and hand over",
    tone: "primary",
    authorising: true,
  },
  approve_ready: {
    id: "approve_ready",
    label: "Approve all ready",
    tone: "primary",
    authorising: true,
  },
  request_revision: {
    id: "request_revision",
    label: "Request revision",
    tone: "secondary",
    authorising: false,
  },
  reject: { id: "reject", label: "Not now", tone: "secondary", authorising: true },
  edit_before_approval: {
    id: "edit_before_approval",
    label: "Edit before approval",
    tone: "secondary",
    authorising: false,
  },
  open_source: { id: "open_source", label: "Open source", tone: "quiet", authorising: false },
  explain: { id: "explain", label: "Ask why", tone: "quiet", authorising: false },
  add_note: { id: "add_note", label: "Add note", tone: "quiet", authorising: false },
};

export function approvalAction(id: ApprovalActionId): ApprovalAction {
  return ACTION[id];
}

/**
 * Which acts make sense for this request, right now.
 *
 * Irrelevant actions are never shown: a decided request offers no decision,
 * and a batch offers "approve all ready" rather than a blanket approve.
 */
export function availableActions(request: {
  approvalType: ApprovalType;
  status: ApprovalStatus;
  batch?: BatchSummary | undefined;
}): ApprovalAction[] {
  const open = OPEN_STATUSES.includes(request.status);
  if (!open) {
    return [ACTION.open_source, ACTION.add_note];
  }

  const decisive: ApprovalActionId[] = [];
  if (request.batch) {
    decisive.push("approve_ready");
  } else {
    switch (request.approvalType) {
      case "comms_draft":
        decisive.push("approve_and_send", "edit_before_approval");
        break;
      case "scout_relationship":
        decisive.push("approve_and_queue");
        break;
      case "roadmap_change":
        decisive.push("approve");
        break;
      case "delivery_change":
        decisive.push("approve_and_execute");
        break;
      default:
        decisive.push("approve");
    }
  }

  /* Nothing can be approved while the request itself says it lacks context. */
  const gated = request.status === "needs_context" ? [] : decisive;

  return [
    ...gated.map((id) => ACTION[id]),
    ACTION.request_revision,
    ACTION.reject,
    ACTION.open_source,
    ACTION.explain,
    ACTION.add_note,
  ];
}

/* ------------------------------------------------------------ authority */

/**
 * May this person decide this request?
 *
 * Two gates, both required: approval authority in the workspace, and the
 * owning room's own write permission. Approvals never substitutes for the
 * room that carries the work.
 */
export function approvalRefusal(input: {
  can: (permission: Permission) => boolean;
  active: boolean;
  requiredCapability: Permission;
  requestOrganizationId: ID;
  organizationId: ID;
}): string | null {
  if (!input.active) return "Your workspace membership is not active.";
  if (input.requestOrganizationId !== input.organizationId) {
    return "That approval belongs to another organization.";
  }
  if (!input.can("conductor.approve")) {
    return "Approving work is a leadership act. Ask an owner or admin.";
  }
  if (!input.can(input.requiredCapability)) {
    return `Deciding this also needs ${input.requiredCapability} in the owning room.`;
  }
  return null;
}

/* ------------------------------------------------------------ idempotency */

/**
 * The stable identity of one piece of source state.
 *
 * A rerender, a retry or a second submit of the same state resolves to the
 * same key, and therefore to the same approval row.
 */
export function approvalSourceKey(input: {
  sourceApp: ApprovalSourceApp;
  approvalType: ApprovalType;
  sourceEntity: SourceEntityRef;
  /** Optional discriminator when one entity can raise more than one request. */
  aspect?: string;
}): string {
  const parts = [
    input.sourceApp,
    input.approvalType,
    input.sourceEntity.type,
    input.sourceEntity.id,
    input.aspect ?? "",
  ];
  return parts.join(":").replace(/:+$/, "");
}

/* ---------------------------------------------------------- prioritisation */

const URGENCY_WEIGHT: Record<UrgencyLevel, number> = { now: 40, soon: 18, whenever: 0 };
const IMPACT_WEIGHT: Record<ImpactLevel, number> = { high: 26, medium: 12, low: 0 };

/**
 * A ranking, not a score to display.
 *
 * It reads only signals the record actually carries: urgency, impact,
 * irreversibility, whether anything downstream is waiting, and age. Where the
 * data is thin the ranking stays coarse rather than inventing precision.
 */
export function priorityRank(request: ApprovalRequest, now: ISODateTime): number {
  let rank = URGENCY_WEIGHT[request.urgency] + IMPACT_WEIGHT[request.impact];

  if (request.status === "ready") rank += 10;
  if (request.status === "needs_context") rank -= 8;
  if (request.batch) rank += Math.min(request.batch.exceptions * 2, 12);
  if (request.boundary.willDo.some((line) => /send|publish|deploy|pay/i.test(line))) rank += 6;

  const ageDays = Math.max(
    0,
    (Date.parse(now) - Date.parse(request.createdAt)) / (1000 * 60 * 60 * 24),
  );
  rank += Math.min(Math.round(ageDays) * 2, 20);
  return rank;
}

export type ApprovalSort = "priority" | "newest" | "oldest";

export function sortApprovals(
  requests: ApprovalRequest[],
  sort: ApprovalSort,
  now: ISODateTime,
): ApprovalRequest[] {
  const rows = [...requests];
  if (sort === "newest") {
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (sort === "oldest") {
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return rows.sort((a, b) => {
    const delta = priorityRank(b, now) - priorityRank(a, now);
    return delta !== 0 ? delta : b.createdAt.localeCompare(a.createdAt);
  });
}

/* ----------------------------------------------------------------- search */

/** Free text across title, summary, source entity, people and company names. */
export function matchesSearch(request: ApprovalRequest, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    request.title,
    request.summary,
    request.whyItNeedsYou,
    request.sourceEntity.label ?? "",
    request.sourceEntity.type,
    SOURCE_APP_LABEL[request.sourceApp],
    APPROVAL_TYPE_LABEL[request.approvalType],
    String(request.payload["personName"] ?? ""),
    String(request.payload["companyName"] ?? ""),
    String(request.payload["clientName"] ?? ""),
    String(request.payload["projectName"] ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/* ------------------------------------------------------------------ counts */

export function tabCounts(requests: ApprovalRequest[]): Record<CategoryTab, number> {
  const counts: Record<CategoryTab, number> = {
    all: 0,
    marketing: 0,
    comms: 0,
    scout: 0,
    roadmap: 0,
    delivery: 0,
  };
  for (const request of requests) {
    if (!OPEN_STATUSES.includes(request.status)) continue;
    counts.all += 1;
    counts[tabFor(request)] += 1;
  }
  return counts;
}

/* ------------------------------------------------------- board pagination */

/** The statuses a board column contains. The inverse of `columnFor`. */
export const BOARD_COLUMN_STATUSES: Record<BoardColumn, ApprovalStatus[]> = {
  needs_review: ["needs_review", "revision_requested"],
  needs_context: ["needs_context"],
  ready: ["ready"],
  approved: ["approved", "queued", "executed"],
};

/* ------------------------------------------------------------ drag to decide */

/**
 * What dragging a card into a column means.
 *
 * Drag is a gesture, never a second decision path: it resolves to the same
 * authorising action the card's own decision bar offers, and refuses anything
 * the state machine or the renderer contract would refuse. Where approval can
 * later trigger something irreversible outside Trust Tai, the gesture asks for
 * a confirmation first rather than committing on a mouse release.
 */
export type DropOutcome =
  | { ok: false; because: string }
  | { ok: true; action: ApprovalAction; confirm: boolean; itemIds?: ID[] };

/** True when approving this could later reach outside Trust Tai irreversibly. */
export function dropNeedsConfirmation(request: {
  approvalType: ApprovalType;
  batch?: BatchSummary | undefined;
  boundary: { willDo: string[] };
}): boolean {
  if (request.batch) return true;
  if (request.approvalType === "blog_batch" || request.approvalType === "delivery_change") {
    return true;
  }
  return request.boundary.willDo.some((line) => /publish|deploy|pay|charge/i.test(line));
}

export function dropOutcome(
  request: Pick<
    ApprovalRequest,
    "approvalType" | "status" | "boundary"
  > & { batch?: BatchSummary | undefined },
  column: BoardColumn,
): DropOutcome {
  const from = columnFor(request.status);
  if (from === column) return { ok: false, because: "It is already there." };

  if (column !== "approved") {
    return {
      ok: false,
      because:
        "Approvals only records a decision. Moving work back is the owning room's call, so use Request revision or Not now.",
    };
  }

  if (!canApprovalTransition(request.status, "approved")) {
    return {
      ok: false,
      because: `An approval cannot move from "${STATUS_LABEL[request.status]}" to "${STATUS_LABEL.approved}".`,
    };
  }

  const action = availableActions({
    approvalType: request.approvalType,
    status: request.status,
    ...(request.batch ? { batch: request.batch } : {}),
  }).find((entry) => entry.authorising && entry.id !== "reject");

  if (!action) {
    return {
      ok: false,
      because:
        request.status === "needs_context"
          ? "This one is still missing context, so it cannot be approved yet."
          : "There is nothing to authorise on this request.",
    };
  }

  return { ok: true, action, confirm: dropNeedsConfirmation(request) };
}
