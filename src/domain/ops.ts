/**
 * Trust Tai OS, the Ops boundary.
 *
 * Ops is a separately deployed specialist application. Trust Tai OS owns
 * identity, membership, canonical projects, shared activity and cross-suite
 * intelligence. Ops owns technical workspace state, runs, approvals, QA and
 * evidence.
 *
 * Two things cross the boundary and nothing else:
 *  1. a launch handshake that hands the current session to the exact Ops
 *     origin, in memory, over postMessage,
 *  2. rows Ops writes into the shared `activities` table, which this file
 *     reads back as observed evidence.
 *
 * Nothing here invents Ops state. An Ops row with no destination routes to Ops
 * home rather than to a guessed project URL.
 */

import type { ActivityEvent } from "./activity";
import type { ID, ISODateTime } from "./entities";

/** Ops production origin. Exact origin, never a wildcard. */
export const OPS_ORIGIN = "https://ops.trusttai.com";

/**
 * The Ops SSO landing screen. Ops matches /^\/sso\/?$/ exactly, so this is
 * "/sso" and nothing longer.
 */
export const OPS_SSO_PATH = "/sso";

export const OPS_APP_ID = "ops";

/** Ops says it is mounted and listening. Contract owned by the Ops bridge. */
export const OPS_READY_MESSAGE = "trust-tai-ops:sso-ready";
/** Trust Tai OS hands the session over. Only ever posted to `OPS_ORIGIN`. */
export const OPS_SESSION_MESSAGE = "trust-tai-os:sso";

/** The Ops event vocabulary Trust Tai OS understands today. */
export const OPS_EVENTS = [
  "ops.issue_detected",
  "ops.run_started",
  "ops.blocked",
  "ops.approval_required",
  "ops.fix_applied",
  "ops.qa_failed",
  "ops.qa_passed",
  "ops.rollback_performed",
  "ops.recommendation_created",
  "ops.completed",
] as const;

export type OpsEventName = (typeof OPS_EVENTS)[number];

/** Events that open or keep open a technical risk. */
export const OPS_RISK_EVENTS: OpsEventName[] = [
  "ops.issue_detected",
  "ops.blocked",
  "ops.qa_failed",
  "ops.approval_required",
  "ops.recommendation_created",
];

/** Events that can clear an earlier risk on the same chain. */
export const OPS_CLEARING_EVENTS: OpsEventName[] = [
  "ops.qa_passed",
  "ops.fix_applied",
  "ops.rollback_performed",
  "ops.completed",
];

/** Which risk events each clearing event may supersede. */
export const OPS_CLEARS: Record<string, OpsEventName[]> = {
  "ops.qa_passed": ["ops.qa_failed", "ops.issue_detected", "ops.blocked"],
  "ops.fix_applied": ["ops.issue_detected", "ops.blocked"],
  "ops.rollback_performed": ["ops.issue_detected", "ops.blocked", "ops.qa_failed"],
  "ops.completed": [
    "ops.issue_detected",
    "ops.blocked",
    "ops.qa_failed",
    "ops.approval_required",
    "ops.recommendation_created",
  ],
};

export interface OpsEvent {
  /** Activity row id. */
  id: ID;
  name: OpsEventName;
  organizationId: ID;
  summary: string;
  at: ISODateTime;
  /** Stable key for "the same happening", used for idempotency. */
  idempotencyKey: string;
  /** What this belongs to: a canonical project, a run, or an issue. */
  chainKey: string;
  canonicalProjectId?: ID;
  runId?: string;
  issueKey?: string;
  /** Where inside Ops the work actually is. Always on the Ops origin. */
  destinationUrl: string;
  /** True only when the row itself records a person's decision. */
  humanDecision: boolean;
  subjectLabel: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function bag(event: ActivityEvent): Record<string, unknown> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const metadata = (payload["metadata"] ?? {}) as Record<string, unknown>;
  return { ...payload, ...(typeof metadata === "object" && metadata ? metadata : {}) };
}

function pick(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return undefined;
}

/** Is this shared-activity row an Ops row? */
export function isOpsActivity(event: ActivityEvent): boolean {
  const source = pick(bag(event), ["source_app", "sourceApp"]);
  return (
    event.provenance.appId === OPS_APP_ID ||
    source === OPS_APP_ID ||
    String(event.name).startsWith("ops.")
  );
}

/** Only Ops destinations on the exact Ops origin are trusted. */
export function opsDestination(candidate: string | undefined): string {
  if (!candidate) return OPS_ORIGIN;
  try {
    const url = new URL(candidate, OPS_ORIGIN);
    return url.origin === OPS_ORIGIN ? url.toString() : OPS_ORIGIN;
  } catch {
    return OPS_ORIGIN;
  }
}

/**
 * Read one shared-activity row as an Ops event, or return null when it is not
 * an Ops row we understand. Unknown Ops verbs are ignored rather than guessed.
 */
export function readOpsEvent(event: ActivityEvent): OpsEvent | null {
  if (!isOpsActivity(event)) return null;
  const name = String(event.name) as OpsEventName;
  if (!(OPS_EVENTS as readonly string[]).includes(name)) return null;

  const source = bag(event);
  const canonicalProjectId = pick(source, [
    "canonical_project_id",
    "canonicalProjectId",
    "project_id",
    "projectId",
  ]);
  const runId = pick(source, ["ops_run_id", "opsRunId", "run_id", "runId"]);
  const issueKey = pick(source, ["issue_key", "issueKey", "issue_id"]);
  const destination = pick(source, [
    "destination_route",
    "destinationRoute",
    "destination_url",
    "destinationUrl",
    "url",
    "deep_link",
  ]);
  // Idempotency, newest shape first: the live `activities.source_event_key`
  // column, then the keys Ops carries inside provenance on older rows.
  const provenanceBag = (event.provenance ?? {}) as unknown as Record<string, unknown>;
  const sourceEventKey =
    pick(source, ["source_event_key", "sourceEventKey", "event_key"]) ??
    pick(provenanceBag, ["ops_event_key", "dedupe_key", "externalRef"]);
  const label =
    pick(source, ["label", "subject_label", "website", "domain", "project_name"]) ??
    event.subject.label ??
    "This work";

  const chainKey = canonicalProjectId ?? runId ?? issueKey ?? event.subject.id ?? event.id;
  const decisionFlag = source["decision"] === true || Boolean(pick(source, ["decided_by"]));

  return {
    id: event.id,
    name,
    organizationId: event.organizationId,
    summary: event.summary || name.replace("ops.", "Ops ").replace(/_/g, " "),
    at: event.occurredAt,
    idempotencyKey: sourceEventKey ?? `${name}:${chainKey}:${event.occurredAt}`,
    chainKey,
    ...(canonicalProjectId ? { canonicalProjectId } : {}),
    ...(runId ? { runId } : {}),
    ...(issueKey ? { issueKey } : {}),
    destinationUrl: opsDestination(destination),
    humanDecision: decisionFlag,
    subjectLabel: label,
  };
}

/** Ops rows for this organization, de-duplicated by idempotency key. */
export function readOpsEvents(events: ActivityEvent[], organizationId: ID): OpsEvent[] {
  const seen = new Set<string>();
  const result: OpsEvent[] = [];
  for (const raw of events) {
    if (raw.organizationId !== organizationId) continue;
    const event = readOpsEvent(raw);
    if (!event) continue;
    if (seen.has(event.idempotencyKey)) continue;
    seen.add(event.idempotencyKey);
    result.push(event);
  }
  return result.sort((a, b) => (a.at < b.at ? 1 : -1));
}
