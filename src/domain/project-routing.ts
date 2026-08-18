/**
 * Projects → Ops / Studio routing contract.
 *
 * A route is a request. Acceptance belongs to the receiving room.
 *
 * Projects owns exactly one new piece of truth here: "Projects asked another
 * room to take this specialized work." It creates no Ops website, no
 * monitoring record, no Studio asset, and no downstream state of any kind.
 * The request carries references and provenance, project, client, roadmap,
 * milestone ids, never copied entities, so Ops and Studio read upstream truth
 * instead of re-researching it.
 *
 * Everything here is pure. Nothing is invented: a request that lacks the
 * context a receiving room would need is refused with the reason, rather than
 * filled in with a plausible value.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { SuiteEventKey } from "./events";
import type { ExecutionProject } from "./projects";

/** The rooms Projects may route specialized work to. */
export type RouteTarget = "ops" | "studio";

export const ROUTE_TARGETS: RouteTarget[] = ["ops", "studio"];

export const ROUTE_TARGET_LABEL: Record<RouteTarget, string> = {
  ops: "Ops",
  studio: "Studio",
};

/** The suite event Projects emits for each target. Only Projects may emit it. */
export const ROUTE_EVENT_KEY: Record<RouteTarget, SuiteEventKey> = {
  ops: "PROJECT_ROUTED_TO_OPS",
  studio: "PROJECT_ROUTED_TO_STUDIO",
};

/**
 * The acceptance vocabulary owned by the receiving room. Projects never emits
 * these; they are listed so readers know what "accepted" will look like when
 * Ops and Studio can record it.
 */
export const RECEIVER_EVENT_KEYS: Record<RouteTarget, SuiteEventKey[]> = {
  ops: ["OPS_WORK_ACCEPTED", "OPS_WORK_STARTED", "OPS_WORK_COMPLETED"],
  studio: ["STUDIO_WORK_ACCEPTED", "STUDIO_WORK_STARTED", "STUDIO_WORK_COMPLETED"],
};

/** Where the routed request stands, as far as Projects can honestly say. */
export type RouteStatus =
  /** Projects asked. Nobody downstream has answered. */
  | "requested"
  /** The receiving room recorded acceptance in the shared stream. */
  | "accepted";

export interface RouteRequestedBy {
  userId: ID;
  label?: string;
}

/**
 * The whole contract. References plus provenance, no duplicated entity ever
 * travels in this envelope.
 */
export interface ProjectRouteRequest {
  organizationId: ID;
  projectId: ID;
  /** As it reads in Projects, for display only. Identity is `projectId`. */
  projectName: string;
  clientId?: ID;
  /** Upstream decision this work descends from, when there is one. */
  roadmapId?: ID;
  milestoneId?: ID;
  /** The specific work item inside the project, when the caller has one. */
  sourceWorkItemId?: ID;
  targetApp: RouteTarget;
  /** What the receiving room is being asked to deliver. */
  requestedOutcome: string;
  /** Why this left Projects. Enough that nobody has to re-research it. */
  because: string;
  /** Point A / Point B carried across unchanged, so context is not retyped. */
  pointA: string;
  pointB: string;
  dependencies: string[];
  /** What is explicitly out of scope for the receiving room. */
  executionBoundary?: string;
  /** Carried exactly as recorded upstream, tier intact. */
  evidence: EvidenceRef[];
  /**
   * Only present when the project already records it. Nothing is scored here:
   * routing invents no priority.
   */
  priority?: string;
  requestedBy: RouteRequestedBy;
  requestedAt: ISODateTime;
  /** Stable natural key, so a retried submission is the same happening. */
  sourceEventKey: string;
  /** Projects can only ever assert this much. */
  status: "requested";
}

export type RouteResult =
  | { ok: true; request: ProjectRouteRequest }
  | { ok: false; because: string };

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Deterministic, so the same ask twice produces the same key. */
function slug(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function routeSourceEventKey(
  target: RouteTarget,
  projectId: ID,
  requestedOutcome: string,
): string {
  return `project.routed_to_${target}:${projectId}:${slug(requestedOutcome)}`;
}

export interface RouteIntent {
  targetApp: RouteTarget;
  requestedOutcome: string;
  because: string;
  sourceWorkItemId?: ID;
  requestedBy: RouteRequestedBy;
  requestedAt?: ISODateTime;
}

/**
 * Build the request from what Projects already holds. Refuses rather than
 * guesses: no outcome, no reason, no destination, no identity, no route.
 */
export function buildRouteRequest(
  project: ExecutionProject,
  intent: RouteIntent,
): RouteResult {
  if (!clean(project.id) || !clean(project.organizationId)) {
    return { ok: false, because: "This project has no stable identity to route from." };
  }
  if (intent.targetApp !== "ops" && intent.targetApp !== "studio") {
    return { ok: false, because: "Work can only be routed to Ops or Studio." };
  }
  if (!clean(intent.requestedBy?.userId)) {
    return { ok: false, because: "A route has to be asked for by a named person." };
  }
  const outcome = clean(intent.requestedOutcome);
  if (!outcome) {
    return {
      ok: false,
      because: "Say what the other room is being asked to deliver, in one sentence.",
    };
  }
  const because = clean(intent.because);
  if (!because) {
    return {
      ok: false,
      because: "Say why this is leaving Projects, so the receiving room does not re-research it.",
    };
  }
  const pointB = clean(project.pointB);
  if (!pointB) {
    return {
      ok: false,
      because: "There is no agreed destination on this project yet. Agree Point B before routing.",
    };
  }

  return {
    ok: true,
    request: {
      organizationId: project.organizationId,
      projectId: project.id,
      projectName: project.name,
      ...(project.clientId ? { clientId: project.clientId } : {}),
      ...(project.origin.roadmapId ? { roadmapId: project.origin.roadmapId } : {}),
      ...(project.origin.milestoneId ? { milestoneId: project.origin.milestoneId } : {}),
      ...(clean(intent.sourceWorkItemId) ? { sourceWorkItemId: intent.sourceWorkItemId! } : {}),
      targetApp: intent.targetApp,
      requestedOutcome: outcome,
      because,
      pointA: clean(project.pointA),
      pointB,
      dependencies: project.dependencies.filter((entry) => clean(entry).length > 0),
      ...(clean(project.executionBoundary)
        ? { executionBoundary: clean(project.executionBoundary) }
        : {}),
      evidence: project.evidence,
      requestedBy: {
        userId: intent.requestedBy.userId,
        ...(clean(intent.requestedBy.label) ? { label: clean(intent.requestedBy.label) } : {}),
      },
      requestedAt: intent.requestedAt ?? new Date().toISOString(),
      sourceEventKey: routeSourceEventKey(intent.targetApp, project.id, outcome),
      status: "requested",
    },
  };
}

/** One honest sentence for the shared stream. Never claims acceptance. */
export function routeSummary(request: ProjectRouteRequest): string {
  return `${request.projectName} asked ${ROUTE_TARGET_LABEL[request.targetApp]} to take: ${request.requestedOutcome}. Requested, not yet accepted.`;
}

/**
 * The metadata carried into the event. References only, the receiving room
 * reads upstream truth through these ids.
 */
export function routeMetadata(request: ProjectRouteRequest): Record<string, unknown> {
  return {
    target_app: request.targetApp,
    project_id: request.projectId,
    ...(request.clientId ? { client_id: request.clientId } : {}),
    ...(request.roadmapId ? { roadmap_id: request.roadmapId } : {}),
    ...(request.milestoneId ? { milestone_id: request.milestoneId } : {}),
    ...(request.sourceWorkItemId ? { source_work_item_id: request.sourceWorkItemId } : {}),
    requested_outcome: request.requestedOutcome,
    because: request.because,
    point_a: request.pointA,
    point_b: request.pointB,
    dependencies: request.dependencies,
    ...(request.executionBoundary ? { execution_boundary: request.executionBoundary } : {}),
    evidence: request.evidence,
    ...(request.priority ? { priority: request.priority } : {}),
    requested_by: request.requestedBy,
    requested_at: request.requestedAt,
    /* Acceptance is the receiving room's to record, never Projects'. */
    status: "requested",
    acceptance: "pending_receiving_room",
  };
}
