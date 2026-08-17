/**
 * Roadmap row shapes and mapping.
 *
 * The Roadmap tables are live in the shared Trust Tai backend. Any Postgrest
 * error is surfaced as itself: no fixtures, no silent fallback, no invented
 * "not set up" story on top of a real failure.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import type { EvidenceRef } from "@/domain/confidence";
import type {
  DecisionState,
  Destination,
  NextMove,
  Roadmap,
  RoadmapDecision,
  RoadmapNote,
  RoadmapStage,
  RoadmapStatus,
  StageState,
  Tier,
} from "@/domain/roadmap";
import { ROADMAP_STATUSES, STAGE_STATES } from "@/domain/roadmap";

export type Row = Record<string, unknown>;

export const ROADMAP_COLUMNS =
  "id, organization_id, client_id, prospect_id, relationship_id, title, subject_label, objective, status, owner_user_id, point_a, point_b, next_move, metadata, created_at, updated_at";

export const STAGE_COLUMNS =
  "id, organization_id, roadmap_id, position, title, intent, state, tier, owner_user_id, owner_label, evidence, created_at, updated_at";

// Selected with "*" so an optional column (labels) can be added to the table
// without this read failing before the migration is applied everywhere.
export const DECISION_COLUMNS = "*";

/** Any Postgrest error is surfaced as itself. */
export function assertOk(error: PostgrestError | null): void {
  if (!error) return;
  throw new Error(error.message);
}

/* ------------------------------------------------------------------ helpers */

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const TIERS: Tier[] = ["observed", "inferred", "decided"];

function tier(value: unknown, fallback: Tier): Tier {
  return TIERS.includes(value as Tier) ? (value as Tier) : fallback;
}

export function evidenceList(value: unknown): EvidenceRef[] {
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

export function noteList(value: unknown): RoadmapNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: String(entry["label"] ?? "Note"),
      value: String(entry["value"] ?? ""),
      tier: tier(entry["tier"], "observed"),
      evidence: evidenceList(entry["evidence"]),
      at: String(entry["at"] ?? new Date().toISOString()),
    }))
    .filter((note) => note.value.length > 0);
}

export function notePayload(notes: RoadmapNote[]): Row[] {
  return notes.map((note) => ({
    label: note.label,
    value: note.value,
    tier: note.tier,
    evidence: note.evidence,
    at: note.at,
  }));
}

function destination(value: unknown): Destination | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  const statement = text(row["statement"]);
  if (!statement) return null;
  return {
    statement,
    tier: row["tier"] === "decided" ? "decided" : "inferred",
    because: String(row["because"] ?? ""),
    evidence: evidenceList(row["evidence"]),
    ...(text(row["approvedBy"]) ? { approvedBy: text(row["approvedBy"])! } : {}),
    ...(text(row["approvedAt"]) ? { approvedAt: text(row["approvedAt"])! } : {}),
  };
}

function nextMove(value: unknown): NextMove | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  const action = text(row["action"]);
  if (!action) return null;
  return {
    action,
    because: String(row["because"] ?? ""),
    tier: tier(row["tier"], "inferred"),
    ...(text(row["ownerUserId"]) ? { ownerUserId: text(row["ownerUserId"])! } : {}),
    ...(text(row["ownerLabel"]) ? { ownerLabel: text(row["ownerLabel"])! } : {}),
  };
}

/* ------------------------------------------------------------------ mapping */

export function toRoadmap(row: Row): Roadmap {
  const status = ROADMAP_STATUSES.includes(row["status"] as RoadmapStatus)
    ? (row["status"] as RoadmapStatus)
    : "draft";
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    ...(text(row["client_id"]) ? { clientId: text(row["client_id"])! } : {}),
    ...(text(row["prospect_id"]) ? { prospectId: text(row["prospect_id"])! } : {}),
    ...(text(row["relationship_id"]) ? { relationshipId: text(row["relationship_id"])! } : {}),
    title: String(row["title"] ?? "Untitled roadmap"),
    subjectLabel: String(row["subject_label"] ?? ""),
    objective: String(row["objective"] ?? ""),
    status,
    ...(text(row["owner_user_id"]) ? { ownerUserId: text(row["owner_user_id"])! } : {}),
    pointA: noteList(row["point_a"]),
    pointB: destination(row["point_b"]),
    nextMove: nextMove(row["next_move"]),
    metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? new Date().toISOString()),
  };
}

export function toStage(row: Row): RoadmapStage {
  const state = STAGE_STATES.includes(row["state"] as StageState)
    ? (row["state"] as StageState)
    : "mapped";
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    position: Number(row["position"] ?? 0),
    title: String(row["title"] ?? ""),
    ...(text(row["intent"]) ? { intent: text(row["intent"])! } : {}),
    state,
    tier: tier(row["tier"], "inferred"),
    ...(text(row["owner_user_id"]) ? { ownerUserId: text(row["owner_user_id"])! } : {}),
    ...(text(row["owner_label"]) ? { ownerLabel: text(row["owner_label"])! } : {}),
    evidence: evidenceList(row["evidence"]),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? new Date().toISOString()),
  };
}

const DECISION_STATES: DecisionState[] = ["open", "approved", "declined", "deferred"];

export function toDecision(row: Row): RoadmapDecision {
  const status = DECISION_STATES.includes(row["status"] as DecisionState)
    ? (row["status"] as DecisionState)
    : "open";
  const options = Array.isArray(row["options"]) ? row["options"].map((entry) => String(entry)) : [];
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    ...(text(row["stage_id"]) ? { stageId: text(row["stage_id"])! } : {}),
    question: String(row["question"] ?? ""),
    whyItMatters: String(row["why_it_matters"] ?? ""),
    options,
    labels: Array.isArray(row["labels"]) ? row["labels"].map((entry) => String(entry)) : [],
    ...(text(row["recommendation"]) ? { recommendation: text(row["recommendation"])! } : {}),
    ...(text(row["recommendation_because"])
      ? { recommendationBecause: text(row["recommendation_because"])! }
      : {}),
    evidence: evidenceList(row["evidence"]),
    ...(text(row["owner_user_id"]) ? { ownerUserId: text(row["owner_user_id"])! } : {}),
    status,
    ...(text(row["resolution_note"]) ? { resolutionNote: text(row["resolution_note"])! } : {}),
    ...(text(row["resolved_by"]) ? { resolvedBy: text(row["resolved_by"])! } : {}),
    ...(text(row["resolved_at"]) ? { resolvedAt: text(row["resolved_at"])! } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? new Date().toISOString()),
  };
}
