/**
 * Roadmap Intelligence v2 row shapes and mapping.
 *
 * The v2 tables live in the shared Trust Tai backend once
 * docs/roadmap-intelligence-v2-schema.sql is applied. Any Postgrest error is
 * surfaced as itself: no fixtures, no silent fallback, no invented
 * "not set up yet" story on top of a real failure.
 */

import type { ConfidenceLevel } from "@/domain/confidence";
import type { Tier } from "@/domain/roadmap";
import type {
  ApprovalState,
  ArtifactSection,
  HorizonBand,
  MilestoneStatus,
  ResearchClaim,
  ResearchCompetitor,
  ResearchStatus,
  RoadmapArtifact,
  RoadmapMilestone,
  RoadmapResearch,
  RoadmapSession,
  RoadmapStrategy,
  SourceRef,
  StrategyItem,
  WalkthroughEntry,
  WalkthroughEntryKind,
} from "@/domain/roadmap-intel";
import { MILESTONE_STATUSES } from "@/domain/roadmap-intel";

export type Row = Record<string, unknown>;

export const RESEARCH_COLUMNS =
  "id, organization_id, roadmap_id, status, company_model, buyers, strengths, digital_presence, competitors, market_direction, sources, unknowns, provider, model, checked_at, error, created_at, updated_at";

export const STRATEGY_COLUMNS =
  "id, organization_id, roadmap_id, point_a, anchor_proof, horizon, point_b, point_c, central_truth, gaps, leverage_point, provider, model, generated_at, created_at, updated_at";

export const MILESTONE_COLUMNS =
  "id, organization_id, roadmap_id, name, what_we_build, intended_user, supporting_market_direction, client_advantage, current_gap, evidence, immediate_value, long_term_value, dependencies, execution_boundary, confidence, priority_score, priority_rationale, recommended_sequence, status, tier, owner_user_id, owner_label, decision_note, decided_by, decided_at, created_at, updated_at";

export const ARTIFACT_COLUMNS =
  "id, organization_id, roadmap_id, kind, title, sections, accent, logo_url, generated_at, created_at, updated_at";

export const SESSION_COLUMNS =
  "id, organization_id, roadmap_id, started_at, ended_at, entries, created_by, created_at, updated_at";

export const QUESTION_COLUMNS =
  "id, organization_id, roadmap_id, question, answer, facts, inferences, unknowns, provider, model, created_at";

/* ------------------------------------------------------------------ helpers */

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

const TIERS: Tier[] = ["observed", "inferred", "decided"];
const LEVELS: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];
const APPROVALS: ApprovalState[] = ["proposed", "approved", "rejected", "deferred"];

function tier(value: unknown, fallback: Tier = "inferred"): Tier {
  return TIERS.includes(value as Tier) ? (value as Tier) : fallback;
}

function level(value: unknown): ConfidenceLevel {
  return LEVELS.includes(value as ConfidenceLevel) ? (value as ConfidenceLevel) : "low";
}

export function sourceList(value: unknown): SourceRef[] {
  return rows(value)
    .map((row) => ({
      label: str(row["label"], "Source"),
      url: str(row["url"]),
      checkedAt: str(row["checkedAt"] ?? row["checked_at"], new Date().toISOString()),
      ...(text(row["provider"]) ? { provider: text(row["provider"])! } : {}),
      ...(text(row["model"]) ? { model: text(row["model"])! } : {}),
    }))
    .filter((ref) => ref.url.length > 0);
}

export function claimList(value: unknown): ResearchClaim[] {
  return rows(value)
    .map((row) => ({
      statement: str(row["statement"]),
      tier: tier(row["tier"]),
      confidence: level(row["confidence"]),
      sources: sourceList(row["sources"]),
    }))
    .filter((claim) => claim.statement.length > 0);
}

export function competitorList(value: unknown): ResearchCompetitor[] {
  return rows(value)
    .map((row) => ({
      name: str(row["name"]),
      ...(text(row["website"]) ? { website: text(row["website"])! } : {}),
      positioning: str(row["positioning"]),
      tier: tier(row["tier"]),
      confidence: level(row["confidence"]),
      sources: sourceList(row["sources"]),
    }))
    .filter((entry) => entry.name.length > 0);
}

export function strategyItem(value: unknown): StrategyItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  const statement = text(row["statement"]);
  if (!statement) return null;
  const approval = APPROVALS.includes(row["approval"] as ApprovalState)
    ? (row["approval"] as ApprovalState)
    : "proposed";
  return {
    key: str(row["key"], statement.slice(0, 40)),
    statement,
    because: str(row["because"]),
    tier: tier(row["tier"], approval === "approved" ? "decided" : "inferred"),
    confidence: level(row["confidence"]),
    sources: sourceList(row["sources"]),
    approval,
    ...(text(row["approvedBy"]) ? { approvedBy: text(row["approvedBy"])! } : {}),
    ...(text(row["approvedAt"]) ? { approvedAt: text(row["approvedAt"])! } : {}),
  };
}

export function strategyItems(value: unknown): StrategyItem[] {
  return rows(value)
    .map((row) => strategyItem(row))
    .filter((item): item is StrategyItem => item !== null);
}

function horizonBands(value: unknown): HorizonBand[] {
  return rows(value)
    .map((row) => {
      const years = Number(row["years"]);
      const band: 2 | 5 | 10 = years === 10 ? 10 : years === 5 ? 5 : 2;
      return {
        years: band,
        statement: str(row["statement"]),
        tier: tier(row["tier"]),
        confidence: level(row["confidence"]),
        sources: sourceList(row["sources"]),
      };
    })
    .filter((band) => band.statement.length > 0)
    .sort((a, b) => a.years - b.years);
}

/* ------------------------------------------------------------------ mapping */

const RESEARCH_STATES: ResearchStatus[] = ["pending", "running", "complete", "failed"];

export function toResearch(row: Row): RoadmapResearch {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    status: RESEARCH_STATES.includes(row["status"] as ResearchStatus)
      ? (row["status"] as ResearchStatus)
      : "complete",
    companyModel: claimList(row["company_model"]),
    buyers: claimList(row["buyers"]),
    strengths: claimList(row["strengths"]),
    digitalPresence: claimList(row["digital_presence"]),
    competitors: competitorList(row["competitors"]),
    marketDirection: claimList(row["market_direction"]),
    sources: sourceList(row["sources"]),
    unknowns: strings(row["unknowns"]),
    ...(text(row["provider"]) ? { provider: text(row["provider"])! } : {}),
    ...(text(row["model"]) ? { model: text(row["model"])! } : {}),
    ...(text(row["checked_at"]) ? { checkedAt: text(row["checked_at"])! } : {}),
    ...(text(row["error"]) ? { error: text(row["error"])! } : {}),
    createdAt: str(row["created_at"], new Date().toISOString()),
    updatedAt: str(row["updated_at"], new Date().toISOString()),
  };
}

export function toStrategy(row: Row): RoadmapStrategy {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    pointA: strategyItems(row["point_a"]),
    anchorProof: strategyItems(row["anchor_proof"]),
    horizon: horizonBands(row["horizon"]),
    pointB: strategyItem(row["point_b"]),
    pointC: strategyItem(row["point_c"]),
    centralTruth: strategyItem(row["central_truth"]),
    gaps: strategyItems(row["gaps"]),
    leveragePoint: strategyItem(row["leverage_point"]),
    ...(text(row["provider"]) ? { provider: text(row["provider"])! } : {}),
    ...(text(row["model"]) ? { model: text(row["model"])! } : {}),
    ...(text(row["generated_at"]) ? { generatedAt: text(row["generated_at"])! } : {}),
    createdAt: str(row["created_at"], new Date().toISOString()),
    updatedAt: str(row["updated_at"], new Date().toISOString()),
  };
}

export function toMilestone(row: Row): RoadmapMilestone {
  const status = MILESTONE_STATUSES.includes(row["status"] as MilestoneStatus)
    ? (row["status"] as MilestoneStatus)
    : "candidate";
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    name: str(row["name"], "Untitled milestone"),
    whatWeBuild: str(row["what_we_build"]),
    intendedUser: str(row["intended_user"]),
    supportingMarketDirection: str(row["supporting_market_direction"]),
    clientAdvantage: str(row["client_advantage"]),
    currentGap: str(row["current_gap"]),
    evidence: sourceList(row["evidence"]),
    immediateValue: str(row["immediate_value"]),
    longTermValue: str(row["long_term_value"]),
    dependencies: strings(row["dependencies"]),
    executionBoundary: str(row["execution_boundary"]),
    confidence: level(row["confidence"]),
    priorityScore: Number(row["priority_score"] ?? 0),
    priorityRationale: strings(row["priority_rationale"]),
    recommendedSequence: Number(row["recommended_sequence"] ?? 0),
    status,
    tier: tier(row["tier"], status === "approved" ? "decided" : "inferred"),
    ...(text(row["owner_user_id"]) ? { ownerUserId: text(row["owner_user_id"])! } : {}),
    ...(text(row["owner_label"]) ? { ownerLabel: text(row["owner_label"])! } : {}),
    ...(text(row["decision_note"]) ? { decisionNote: text(row["decision_note"])! } : {}),
    ...(text(row["decided_by"]) ? { decidedBy: text(row["decided_by"])! } : {}),
    ...(text(row["decided_at"]) ? { decidedAt: text(row["decided_at"])! } : {}),
    createdAt: str(row["created_at"], new Date().toISOString()),
    updatedAt: str(row["updated_at"], new Date().toISOString()),
  };
}

export function sectionList(value: unknown): ArtifactSection[] {
  return rows(value)
    .map((row) => ({
      key: str(row["key"], "section"),
      title: str(row["title"]),
      body: strings(row["body"]),
      tier: tier(row["tier"]),
      sources: sourceList(row["sources"]),
      ...(text(row["visualDirection"]) ? { visualDirection: text(row["visualDirection"])! } : {}),
      ...(text(row["caption"]) ? { caption: text(row["caption"])! } : {}),
      ...(Array.isArray(row["unlocks"]) ? { unlocks: strings(row["unlocks"]) } : {}),
    }))
    .filter((section) => section.title.length > 0);
}

export function toArtifact(row: Row): RoadmapArtifact {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    kind: row["kind"] === "full" ? "full" : "preview",
    title: str(row["title"]),
    sections: sectionList(row["sections"]),
    ...(text(row["accent"]) ? { accent: text(row["accent"])! } : {}),
    ...(text(row["logo_url"]) ? { logoUrl: text(row["logo_url"])! } : {}),
    ...(text(row["provider"]) ? { provider: text(row["provider"])! } : {}),
    ...(text(row["model"]) ? { model: text(row["model"])! } : {}),
    rejected: rows(row["rejected"]).map((entry) => ({
      section: str(entry["section"], "section"),
      line: str(entry["line"]),
      reason: str(entry["reason"]),
    })),
    humanEdited: row["human_edited"] === true,
    ...(text(row["edited_at"]) ? { editedAt: text(row["edited_at"])! } : {}),
    ...(text(row["edited_by"]) ? { editedBy: text(row["edited_by"])! } : {}),
    generatedAt: str(row["generated_at"], new Date().toISOString()),

    createdAt: str(row["created_at"], new Date().toISOString()),
    updatedAt: str(row["updated_at"], new Date().toISOString()),
  };
}

const ENTRY_KINDS: WalkthroughEntryKind[] = [
  "note",
  "approval",
  "rejection",
  "change",
  "question",
  "next_action",
];

export function entryList(value: unknown): WalkthroughEntry[] {
  return rows(value)
    .map((row) => ({
      kind: ENTRY_KINDS.includes(row["kind"] as WalkthroughEntryKind)
        ? (row["kind"] as WalkthroughEntryKind)
        : "note",
      body: str(row["body"]),
      at: str(row["at"], new Date().toISOString()),
      ...(text(row["milestoneId"]) ? { milestoneId: text(row["milestoneId"])! } : {}),
      ...(text(row["authorId"]) ? { authorId: text(row["authorId"])! } : {}),
    }))
    .filter((entry) => entry.body.length > 0);
}

export function toSession(row: Row): RoadmapSession {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    startedAt: str(row["started_at"], new Date().toISOString()),
    ...(text(row["ended_at"]) ? { endedAt: text(row["ended_at"])! } : {}),
    entries: entryList(row["entries"]),
    ...(text(row["created_by"]) ? { createdBy: text(row["created_by"])! } : {}),
    createdAt: str(row["created_at"], new Date().toISOString()),
    updatedAt: str(row["updated_at"], new Date().toISOString()),
  };
}
