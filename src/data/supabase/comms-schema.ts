/**
 * Comms row shapes and mapping.
 *
 * The Comms tables are live in the Trust Tai Supabase project, so a failed read
 * is a real failure: a permission problem, a network problem, or a bug. It is
 * reported as itself rather than dressed up as a missing feature.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import type {
  CommsDraft,
  DraftReviewState,
  MemoryItem,
  Reminder,
  Relationship,
  RelationshipSource,
  RelationshipStage,
  ThreadChannel,
  Touch,
} from "@/domain/comms";
import { RELATIONSHIP_STAGES } from "@/domain/comms";
import type { EvidenceRef } from "@/domain/confidence";

export type Row = Record<string, unknown>;

/** Any Postgrest error is surfaced with its own message, never swallowed. */
export function assertOk(error: PostgrestError | null): void {
  if (!error) return;
  throw new Error(error.message);
}

/* ------------------------------------------------------------------ helpers */

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const CHANNELS: ThreadChannel[] = ["email", "call", "meeting", "message", "note", "linkedin"];

const REVIEW_STATES: DraftReviewState[] = [
  "draft",
  "needs_human_review",
  "approved",
  "sending",
  "sent",
  "send_failed",
  "discarded",
];

const SOURCES: RelationshipSource[] = ["scout_handoff", "in_person", "manual", "inbound"];

function evidence(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: String(entry["label"] ?? "Evidence"),
      kind: (["page", "provider", "human", "computed"] as const).includes(entry["kind"] as never)
        ? (entry["kind"] as EvidenceRef["kind"])
        : "computed",
      ...(text(entry["url"]) ? { url: text(entry["url"])! } : {}),
    }));
}

function memory(value: unknown, tier: MemoryItem["tier"]): MemoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: String(entry["label"] ?? "Note"),
      value: String(entry["value"] ?? ""),
      tier: (["observed", "inferred", "decided"] as const).includes(entry["tier"] as never)
        ? (entry["tier"] as MemoryItem["tier"])
        : tier,
      evidence: evidence(entry["evidence"]),
      at: String(entry["at"] ?? new Date().toISOString()),
      ...(text(entry["category"]) ? { category: text(entry["category"])! } : {}),
      ...(text(entry["due"]) ? { due: text(entry["due"])! } : {}),
      ...(["open", "kept", "released"].includes(String(entry["status"]))
        ? { status: entry["status"] as NonNullable<MemoryItem["status"]> }
        : {}),

      ...(text(entry["owner"]) ? { owner: text(entry["owner"])! } : {}),
      ...(text(entry["added_by"]) ? { addedBy: text(entry["added_by"])! } : {}),
    }))
    .filter((entry) => entry.value.length > 0);
}

/* ------------------------------------------------------------------- rows */

export interface RelationshipRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  client_id: string | null;
  prospect_id: string | null;
  full_name: string;
  company_name: string | null;
  email: string | null;
  stage: string;
  owner_user_id: string | null;
  source: string;
  met_at: string | null;
  met_where: string | null;
  last_touch_at: string | null;
  next_action: string | null;
  response_due_at: string | null;
  follow_up_due_at: string | null;
  observed: unknown;
  inferred: unknown;
  decided: unknown;
  metadata: Row | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export const RELATIONSHIP_COLUMNS =
  "id, organization_id, contact_id, client_id, prospect_id, full_name, company_name, email, stage, owner_user_id, source, met_at, met_where, last_touch_at, next_action, response_due_at, follow_up_due_at, observed, inferred, decided, metadata, created_by, created_at, updated_at";

export function toRelationship(row: RelationshipRow): Relationship {
  const stage = RELATIONSHIP_STAGES.includes(row.stage as RelationshipStage)
    ? (row.stage as RelationshipStage)
    : "new";
  const source = SOURCES.includes(row.source as RelationshipSource)
    ? (row.source as RelationshipSource)
    : "manual";

  return {
    id: row.id,
    organizationId: row.organization_id,
    ...(row.contact_id ? { contactId: row.contact_id } : {}),
    ...(row.client_id ? { clientId: row.client_id } : {}),
    ...(row.prospect_id ? { prospectId: row.prospect_id } : {}),
    fullName: row.full_name,
    ...(row.company_name ? { companyName: row.company_name } : {}),
    ...(row.email ? { email: row.email } : {}),
    stage,
    ...(row.owner_user_id ? { ownerUserId: row.owner_user_id } : {}),
    source,
    ...(row.met_at ? { metAt: row.met_at } : {}),
    ...(row.met_where ? { metWhere: row.met_where } : {}),
    ...(row.last_touch_at ? { lastTouchAt: row.last_touch_at } : {}),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    ...(row.response_due_at ? { responseDueAt: row.response_due_at } : {}),
    ...(row.follow_up_due_at ? { followUpDueAt: row.follow_up_due_at } : {}),
    observed: memory(row.observed, "observed"),
    inferred: memory(row.inferred, "inferred"),
    decided: memory(row.decided, "decided"),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export interface TouchRow {
  id: string;
  organization_id: string;
  relationship_id: string;
  thread_id: string | null;
  channel: string;
  direction: string;
  occurred_at: string;
  summary: string;
  body: string | null;
  logged_by: string | null;
  /** Human set only. Never inferred from a subject line or a transcript. */
  meeting_kind?: string | null;
  provenance?: unknown;
}

export const TOUCH_COLUMNS =
  "id, organization_id, relationship_id, thread_id, channel, direction, occurred_at, summary, body, logged_by, meeting_kind, provenance";


export function toTouch(row: TouchRow): Touch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    relationshipId: row.relationship_id,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    channel: CHANNELS.includes(row.channel as ThreadChannel)
      ? (row.channel as ThreadChannel)
      : "note",
    direction: row.direction === "inbound" ? "inbound" : "outbound",
    occurredAt: row.occurred_at,
    summary: row.summary,
    ...(row.body ? { body: row.body } : {}),
    ...(row.logged_by ? { loggedBy: row.logged_by } : {}),
    ...(row.provenance && typeof row.provenance === "object"
      ? { provenance: row.provenance as Record<string, unknown> }
      : {}),
  };
}

export interface DraftRow {
  id: string;
  organization_id: string;
  relationship_id: string;
  intent: string;
  register: string;
  subject: string | null;
  body: string;
  voice_version: number | null;
  review_state: string;
  rationale: Row | null;
  evidence: unknown;
  created_by: string | null;
  created_at: string;
}

export const DRAFT_COLUMNS =
  "id, organization_id, relationship_id, intent, register, subject, body, voice_version, review_state, rationale, evidence, created_by, created_at";

export function toDraft(row: DraftRow): CommsDraft {
  return {
    id: row.id,
    organizationId: row.organization_id,
    relationshipId: row.relationship_id,
    intent: row.intent,
    register: row.register,
    ...(row.subject ? { subject: row.subject } : {}),
    body: row.body,
    voiceVersion: Number(row.voice_version ?? 1),
    reviewState: REVIEW_STATES.includes(row.review_state as DraftReviewState)
      ? (row.review_state as DraftReviewState)
      : "draft",
    rationale: (row.rationale ?? {}) as Record<string, unknown>,
    evidence: evidence(row.evidence),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    createdAt: row.created_at,
  };
}

export interface ReminderRow {
  id: string;
  organization_id: string;
  relationship_id: string;
  reason_code: string;
  reason_text: string;
  evidence: unknown;
  due_at: string | null;
  state: string;
  created_at: string;
}

export const REMINDER_COLUMNS =
  "id, organization_id, relationship_id, reason_code, reason_text, evidence, due_at, state, created_at";

export function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    organizationId: row.organization_id,
    relationshipId: row.relationship_id,
    reasonCode: row.reason_code as Reminder["reasonCode"],
    reasonText: row.reason_text,
    evidence: evidence(row.evidence),
    ...(row.due_at ? { dueAt: row.due_at } : {}),
    state: row.state === "acted" || row.state === "dismissed" ? row.state : "pending",
    createdAt: row.created_at,
  };
}

/** Memory items are stored as plain JSON, exactly as they are read back. */
export function memoryPayload(items: MemoryItem[]): Row[] {
  return items.map((item) => ({
    label: item.label,
    value: item.value,
    tier: item.tier,
    evidence: item.evidence,
    at: item.at,
    ...(item.category ? { category: item.category } : {}),
    ...(item.due ? { due: item.due } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.owner ? { owner: item.owner } : {}),
    ...(item.addedBy ? { added_by: item.addedBy } : {}),
  }));
}
