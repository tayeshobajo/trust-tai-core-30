/**
 * Trust Tai OS — the Projects execution contract.
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

export function stateFromLifecycle(status: string | null | undefined): ExecutionState {
  switch (status) {
    case "in_build":
      return "in_flight";
    case "needs_decision":
      return "in_review";
    case "blocked":
      return "blocked";
    case "at_risk":
      return "in_flight";
    case "live":
      return "delivered";
    default:
      return "not_started";
  }
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
      move: `${project.nextMove.trim()} — or say honestly that it has stalled.`,
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
  origin: ProjectOrigin;
}
