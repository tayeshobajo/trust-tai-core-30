/**
 * Trust Tai OS, the Projects execution contract.
 *
 * Projects is not a task tracker. It is the room where a Decided milestone
 * becomes work with an owner, a Point A, a Point B, and one honest next move.
 * Everything here is a pure contract or a pure derivation: health and next
 * move are read from what is recorded, never assumed, and every derivation can
 * say why in a plain sentence.
 *
 * Truth boundary: Roadmap decides *what* gets built. Projects records *what is
 * actually happening* to that decision. A project can only exist because a
 * person approved something upstream, or because a person deliberately started
 * it here.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime, LifecycleStatus } from "./entities";

/** Where a piece of delivery actually stands. */
export type ExecutionState =
  | "not_started"
  | "in_flight"
  | "in_review"
  | "blocked"
  | "delivered"
  | "closed";

export const EXECUTION_STATES: ExecutionState[] = [
  "not_started",
  "in_flight",
  "in_review",
  "blocked",
  "delivered",
  "closed",
];

export const EXECUTION_STATE_LABEL: Record<ExecutionState, string> = {
  not_started: "Not started",
  in_flight: "In flight",
  in_review: "In review",
  blocked: "Blocked",
  delivered: "Delivered",
  closed: "Closed",
};

/** How the shared `projects.status` column reads for each execution state. */
export const LIFECYCLE_FOR_STATE: Record<ExecutionState, LifecycleStatus> = {
  not_started: "mapped",
  in_flight: "in_build",
  in_review: "needs_decision",
  blocked: "blocked",
  delivered: "live",
  closed: "live",
};

/**
 * What the `projects.status` column actually accepts in the shared backend.
 * The column is constrained to a coarse lifecycle, so the precise execution
 * state lives in metadata and this is only the shelf it is filed under.
 */
export type ProjectStatusColumn = "planned" | "active" | "blocked" | "complete" | "archived";

export const STATUS_COLUMN_FOR_STATE: Record<ExecutionState, ProjectStatusColumn> = {
  not_started: "planned",
  in_flight: "active",
  in_review: "active",
  blocked: "blocked",
  delivered: "complete",
  closed: "archived",
};

export function stateFromLifecycle(status: string | null | undefined): ExecutionState {
  switch (status) {
    case "in_build":
    case "active":
      return "in_flight";
    case "needs_decision":
      return "in_review";
    case "blocked":
      return "blocked";
    case "at_risk":
      return "in_flight";
    case "live":
    case "complete":
      return "delivered";
    case "archived":
      return "closed";
    default:
      return "not_started";
  }
}

/* ------------------------------------------------------- state machine */

/**
 * Which moves are legal, and only those. Delivery states are a person's
 * decision, but not every jump is honest: work cannot land without having
 * started, and closed work does not quietly reopen.
 */
export const ALLOWED_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  not_started: ["in_flight", "blocked", "closed"],
  in_flight: ["in_review", "blocked", "delivered", "not_started", "closed"],
  in_review: ["in_flight", "blocked", "delivered", "closed"],
  blocked: ["in_flight", "in_review", "not_started", "closed"],
  delivered: ["closed", "in_flight"],
  closed: [],
};

export interface TransitionCheck {
  ok: boolean;
  because: string;
}

/**
 * Can this project move there, and why not. Pure: the same record and the same
 * target always give the same answer, so the button and the write agree.
 */
export function checkTransition(
  project: Pick<
    ExecutionProject,
    "state" | "pointB" | "ownerUserId" | "ownerLabel" | "blockedBecause"
  >,
  to: ExecutionState,
  changes: { blockedBecause?: string; ownerLabel?: string; ownerUserId?: ID } = {},
): TransitionCheck {
  const from = project.state;
  if (from === to) return { ok: true, because: "Already there." };

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      because:
        from === "closed"
          ? "Closed work cannot be moved again. Start it fresh if it is genuinely back."
          : `${EXECUTION_STATE_LABEL[from]} cannot move straight to ${EXECUTION_STATE_LABEL[to]}.`,
    };
  }

  if (to === "blocked") {
    const reason = (changes.blockedBecause ?? project.blockedBecause ?? "").trim();
    if (!reason) {
      return { ok: false, because: "Say what is blocking it. A block nobody named cannot be cleared." };
    }
  }

  if (to === "in_flight" || to === "in_review") {
    const owned = Boolean(
      changes.ownerUserId ??
        project.ownerUserId ??
        (changes.ownerLabel ?? project.ownerLabel ?? "").trim(),
    );
    if (!owned) {
      return { ok: false, because: "Name who carries this before it moves." };
    }
  }

  if (to === "delivered" && !project.pointB.trim()) {
    return { ok: false, because: "There is no agreed destination, so nothing can be called done." };
  }

  return { ok: true, because: `Moves to ${EXECUTION_STATE_LABEL[to]}.` };
}

/** The legal next states for this project, in the order the room offers them. */
export function nextStates(project: ExecutionProject): ExecutionState[] {
  return ALLOWED_TRANSITIONS[project.state];
}




export type ProjectHealth = "on_track" | "needs_attention" | "at_risk" | "unknown";

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: "On track",
  needs_attention: "Needs attention",
  at_risk: "At risk",
  unknown: "Not enough recorded",
};

/** Where this work came from. Delivery without provenance is not delivery. */
export interface ProjectOrigin {
  /** "roadmap_milestone" when a Decided milestone was carried across. */
  kind: "roadmap_milestone" | "manual";
  roadmapId?: ID;
  milestoneId?: ID;
  /** The company or person the work is for, as it reads upstream. */
  subjectLabel?: string;
}

/** One unit of delivery inside a project. Recorded, never inferred. */
export interface DeliveryItem {
  label: string;
  done: boolean;
}

export interface ExecutionProject {
  id: ID;
  organizationId: ID;
  name: string;
  state: ExecutionState;
  clientId?: ID;
  ownerUserId?: ID;
  ownerLabel?: string;
  /** Current truth. */
  pointA: string;
  /** Agreed destination. */
  pointB: string;
  nextMove?: string;
  /** Recorded only while the state is blocked. */
  blockedBecause?: string;
  /**
   * What this is waiting on. Waiting is not a stored execution state: it is
   * in-flight work a person has said is paused on someone else, recorded in
   * their own words so nobody has to guess why nothing is moving.
   */
  waitingOn?: string;
  /** When the block was first recorded, so "blocked for N days" is honest. */
  blockedSince?: ISODateTime;
  /** Agreed delivery date, when one has been agreed. */
  dueDate?: ISODateTime;
  /** The delivery items a person recorded. Absent means none recorded yet. */
  deliveryItems?: DeliveryItem[];
  /** The single thing being worked on right now. */
  currentWork?: string;
  /** What the work rests on. Carried from the milestone that decided it. */
  evidence: EvidenceRef[];
  dependencies: string[];
  executionBoundary?: string;
  origin: ProjectOrigin;
  /** Last time a person moved this, not the last time a row was touched. */
  lastMovedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}


/** After this long with no recorded movement, silence is itself a signal. */
export const STALE_AFTER_DAYS = 14;

export function isOpenProject(project: ExecutionProject): boolean {
  return project.state !== "delivered" && project.state !== "closed";
}

function daysSince(at: ISODateTime, now: Date): number {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/** Health is derived from the record, and always explains itself. */
export function projectHealth(
  project: ExecutionProject,
  now: Date = new Date(),
): { level: ProjectHealth; because: string } {
  if (project.state === "delivered" || project.state === "closed") {
    return { level: "on_track", because: "This work is finished." };
  }
  if (project.state === "blocked") {
    return {
      level: "at_risk",
      because: project.blockedBecause?.trim() || "Marked blocked with no reason recorded.",
    };
  }
  const idle = daysSince(project.lastMovedAt, now);
  if (idle >= STALE_AFTER_DAYS) {
    return {
      level: "at_risk",
      because: `Nothing has moved for ${idle} days.`,
    };
  }
  if (!project.nextMove?.trim()) {
    return { level: "needs_attention", because: "No next move is on record." };
  }
  if (!project.ownerUserId && !project.ownerLabel) {
    return { level: "needs_attention", because: "No one is named as carrying it." };
  }
  if (!project.pointB.trim()) {
    return { level: "needs_attention", because: "There is no agreed destination yet." };
  }
  return { level: "on_track", because: `Owned, moving, and last touched ${idle} days ago.` };
}

/**
 * The one move this project is asking for. Deterministic: the same record
 * always produces the same recommendation.
 */
export function recommendedMove(
  project: ExecutionProject,
  now: Date = new Date(),
): { move: string; because: string } {
  if (project.state === "closed") {
    return { move: "Nothing. This is closed.", because: "Closed work does not ask for anything." };
  }
  if (project.state === "delivered") {
    return {
      move: "Close it, or record what is still owed.",
      because: "Delivered work left open quietly becomes unfinished work.",
    };
  }
  if (project.state === "blocked") {
    return {
      move: project.blockedBecause?.trim()
        ? `Clear the block: ${project.blockedBecause.trim()}`
        : "Record what is blocking this, so it can be cleared.",
      because: "A block nobody has named cannot be removed.",
    };
  }
  if (!project.ownerUserId && !project.ownerLabel) {
    return {
      move: "Name who carries this.",
      because: "Work without an owner does not move.",
    };
  }
  if (!project.pointB.trim()) {
    return {
      move: "Agree the destination before more work goes in.",
      because: "Without Point B there is no way to know when this is done.",
    };
  }
  if (!project.nextMove?.trim()) {
    return {
      move: "Write the next move in one sentence.",
      because: "A project with no next move is a project nobody can pick up.",
    };
  }
  const idle = daysSince(project.lastMovedAt, now);
  if (idle >= STALE_AFTER_DAYS) {
    return {
      move: `${project.nextMove.trim()} · or say honestly that it has stalled.`,
      because: `The recorded next move has not moved in ${idle} days.`,
    };
  }
  return { move: project.nextMove.trim(), because: "This is the move on record." };
}

/** What a person writes to start work. Nothing is invented from this. */
export interface ProjectInput {
  name: string;
  pointA: string;
  pointB: string;
  nextMove?: string;
  ownerUserId?: ID;
  ownerLabel?: string;
  clientId?: ID;
  evidence?: EvidenceRef[];
  dependencies?: string[];
  executionBoundary?: string;
  dueDate?: ISODateTime;
  deliveryItems?: DeliveryItem[];
  currentWork?: string;
  origin: ProjectOrigin;
}
