/**
 * The routing ledger, what Projects asked of Ops and Studio, and what came back.
 *
 * Nothing is stored twice: the ledger is *read* from the shared activity
 * stream. A route is a request (`project.routed_to_*`), acceptance belongs to
 * the receiving room (`ops.work_accepted` / `studio.work_accepted`), and a
 * withdrawal (`project.route_withdrawn`) is Projects taking its own ask back.
 *
 * Two rules are enforced here, and only here, so every reader agrees:
 *   1. A withdrawn route can never become accepted. Acceptance recorded after
 *      a withdrawal is refused and shown as refused, not silently applied.
 *   2. A route nobody has answered after N days is unanswered, a fact about
 *      silence, never an accusation about a room.
 */

import type { ActivityEvent } from "./activity";
import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import { ROUTE_TARGET_LABEL, type RouteTarget } from "./project-routing";

/** Days of silence before a request is reported as unanswered. */
export const UNANSWERED_AFTER_DAYS = 3;

export type RouteLedgerStatus = "requested" | "accepted" | "withdrawn";

export interface RouteNotification {
  at: ISODateTime;
  delivered: boolean;
  because: string;
}

export interface RouteLedgerEntry {
  /** The route's stable identity: the request's `sourceEventKey`. */
  key: string;
  organizationId: ID;
  projectId: ID;
  projectName: string;
  targetApp: RouteTarget;
  requestedOutcome: string;
  because: string;
  requestedAt: ISODateTime;
  requestedByLabel?: string;
  evidence: EvidenceRef[];
  dependencies: string[];
  executionBoundary?: string;
  status: RouteLedgerStatus;
  acceptedAt?: ISODateTime;
  withdrawnAt?: ISODateTime;
  withdrawnBecause?: string;
  /** Acceptance the receiving room tried to record after a withdrawal. */
  refusedAcceptanceAt?: ISODateTime;
  notification?: RouteNotification;
  ageDays: number;
  unanswered: boolean;
}

const ROUTE_NAMES: Record<string, RouteTarget> = {
  "project.routed_to_ops": "ops",
  "project.routed_to_studio": "studio",
};

const ACCEPT_NAMES: Record<string, RouteTarget> = {
  "ops.work_accepted": "ops",
  "studio.work_accepted": "studio",
};

const WITHDRAW_NAME = "project.route_withdrawn";
const NOTIFY_NAME = "project.route_notified";

function payload(event: ActivityEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The route a follow-up event is about, as recorded by its emitter. */
function referencedKey(event: ActivityEvent): string {
  const data = payload(event);
  return text(data["route_event_key"]) || text(data["routeEventKey"]);
}

function dayDiff(from: string, to: number): number {
  const started = Date.parse(from);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((to - started) / 86_400_000));
}

export interface RouteLedgerOptions {
  now?: Date;
  unansweredAfterDays?: number;
}

/**
 * Fold the shared stream into one row per route. Events may arrive in any
 * order; the fold is deterministic either way.
 */
export function buildRouteLedger(
  events: ActivityEvent[],
  options: RouteLedgerOptions = {},
): RouteLedgerEntry[] {
  const now = (options.now ?? new Date()).getTime();
  const threshold = options.unansweredAfterDays ?? UNANSWERED_AFTER_DAYS;
  const entries = new Map<string, RouteLedgerEntry>();

  for (const event of events) {
    const target = ROUTE_NAMES[event.name as string];
    if (!target) continue;
    const data = payload(event);
    const key = text(data["source_event_key"]) || `${event.name}:${event.subject.id}`;
    entries.set(key, {
      key,
      organizationId: event.organizationId,
      projectId: text(data["project_id"]) || event.subject.id,
      projectName: event.subject.label || text(data["label"]) || "This project",
      targetApp: target,
      requestedOutcome: text(data["requested_outcome"]),
      because: text(data["because"]),
      requestedAt: text(data["requested_at"]) || event.occurredAt,
      ...(text((data["requested_by"] as Record<string, unknown>)?.["label"])
        ? { requestedByLabel: text((data["requested_by"] as Record<string, unknown>)["label"]) }
        : {}),
      evidence: Array.isArray(data["evidence"]) ? (data["evidence"] as EvidenceRef[]) : [],
      dependencies: list(data["dependencies"]),
      ...(text(data["execution_boundary"])
        ? { executionBoundary: text(data["execution_boundary"]) }
        : {}),
      status: "requested",
      ageDays: 0,
      unanswered: false,
    });
  }

  /* Withdrawals before acceptances, so a late acceptance is refused. */
  for (const event of events) {
    if ((event.name as string) !== WITHDRAW_NAME) continue;
    const entry = entries.get(referencedKey(event));
    if (!entry) continue;
    entry.status = "withdrawn";
    entry.withdrawnAt = event.occurredAt;
    const why = text(payload(event)["because"]);
    if (why) entry.withdrawnBecause = why;
  }

  for (const event of events) {
    const target = ACCEPT_NAMES[event.name as string];
    if (!target) continue;
    const entry = entries.get(referencedKey(event));
    if (!entry || entry.targetApp !== target) continue;
    if (entry.status === "withdrawn") {
      entry.refusedAcceptanceAt = event.occurredAt;
      continue;
    }
    entry.status = "accepted";
    entry.acceptedAt = event.occurredAt;
  }

  for (const event of events) {
    if ((event.name as string) !== NOTIFY_NAME) continue;
    const entry = entries.get(referencedKey(event));
    if (!entry) continue;
    const data = payload(event);
    entry.notification = {
      at: event.occurredAt,
      delivered: data["delivered"] === true,
      because: text(data["because"]),
    };
  }

  return [...entries.values()]
    .map((entry) => {
      const ageDays = dayDiff(entry.requestedAt, now);
      return {
        ...entry,
        ageDays,
        unanswered: entry.status === "requested" && ageDays >= threshold,
      };
    })
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

/** Only requests still open may be accepted by the receiving room. */
export function canAcceptRoute(entry: RouteLedgerEntry | undefined): boolean {
  return Boolean(entry) && entry!.status === "requested";
}

export function unansweredRoutes(entries: RouteLedgerEntry[]): RouteLedgerEntry[] {
  return entries.filter((entry) => entry.unanswered);
}

/** One honest sentence about where a route stands. */
export function routeStanding(entry: RouteLedgerEntry): string {
  const room = ROUTE_TARGET_LABEL[entry.targetApp];
  if (entry.status === "withdrawn") {
    return entry.refusedAcceptanceAt
      ? `Withdrawn. ${room} recorded acceptance afterwards; it was refused.`
      : `Withdrawn by Projects. ${room} owes nothing on this.`;
  }
  if (entry.status === "accepted") return `${room} accepted it and owns the work.`;
  if (entry.unanswered) {
    return `${room} has not answered in ${entry.ageDays} day${entry.ageDays === 1 ? "" : "s"}.`;
  }
  return `Asked ${entry.ageDays === 0 ? "today" : `${entry.ageDays} day${entry.ageDays === 1 ? "" : "s"} ago`}. Not yet answered.`;
}
