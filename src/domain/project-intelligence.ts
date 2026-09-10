/**
 * Trust Tai OS, project intelligence.
 *
 * A project is not only a task container. It is the shared environment where a
 * person or an agent can find out what this work is, why it exists, what has
 * been decided, where the thinking lives, which assets are approved and where
 * it is being built.
 *
 * Truth boundary, in order:
 *   Roadmap owns strategic milestone truth.
 *   Projects owns project state and execution context.
 *   GitHub owns code truth. Lovable owns its build state.
 *   Paperclip owns agent execution state. Fathom owns meeting evidence.
 *   External ChatGPT / Claude conversations are SOURCES, never canon.
 *
 * Nothing in this module invents a status. A link is a link until a real
 * integration reads it.
 */

import type { ID, ISODateTime } from "./entities";

/* --------------------------------------------------------- thinking rooms */

export type ThinkingSourceType = "chatgpt" | "claude" | "google_doc" | "notion" | "other";

export const THINKING_SOURCE_LABEL: Record<ThinkingSourceType, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  google_doc: "Google Doc",
  notion: "Notion",
  other: "Other",
};

/**
 * What the OS can honestly do with this source right now. `imported` is the
 * only state that means project knowledge came out of it.
 */
export type SourceSyncState =
  "link_saved" | "import_available" | "import_needs_upload" | "imported" | "sync_unavailable";

export const SOURCE_SYNC_LABEL: Record<SourceSyncState, string> = {
  link_saved: "Link saved",
  import_available: "Import available",
  import_needs_upload: "Import needs upload or paste",
  imported: "Imported",
  sync_unavailable: "Sync unavailable",
};

export interface ThinkingSource {
  id: ID;
  organizationId: ID;
  projectId: ID;
  sourceType: ThinkingSourceType;
  title: string;
  url: string;
  isPrimary: boolean;
  syncState: SourceSyncState;
  notes?: string;
  lastReviewedAt?: ISODateTime;
  addedBy?: ID;
  addedByLabel?: string;
  createdAt: ISODateTime;
}

export interface ThinkingSourceInput {
  sourceType: ThinkingSourceType;
  title: string;
  url: string;
  isPrimary?: boolean;
  notes?: string;
}

/**
 * Private assistant transcripts are not machine readable from a URL. Saying so
 * is the whole point: the person is told what will actually happen.
 */
export function syncStateFor(sourceType: ThinkingSourceType): SourceSyncState {
  if (sourceType === "chatgpt" || sourceType === "claude") return "import_needs_upload";
  return "link_saved";
}

/* ------------------------------------------------------- project knowledge */

export type KnowledgeSection =
  | "brief"
  | "objective"
  | "why"
  | "requirement"
  | "decision"
  | "constraint"
  | "open_question"
  | "idea"
  | "meeting"
  | "reference";

export const KNOWLEDGE_SECTION_LABEL: Record<KnowledgeSection, string> = {
  brief: "Project brief",
  objective: "Objective",
  why: "Why it matters",
  requirement: "Requirements",
  decision: "Confirmed decisions",
  constraint: "Constraints and do-not-change rules",
  open_question: "Open questions",
  idea: "Ideas",
  meeting: "Meeting memory",
  reference: "Source references",
};

export const KNOWLEDGE_SECTIONS = Object.keys(KNOWLEDGE_SECTION_LABEL) as KnowledgeSection[];

/** Detected content is never canon until a person confirms it. */
export type KnowledgeReviewState = "detected" | "needs_review" | "confirmed" | "superseded";

export const KNOWLEDGE_REVIEW_LABEL: Record<KnowledgeReviewState, string> = {
  detected: "Detected",
  needs_review: "Needs review",
  confirmed: "Confirmed",
  superseded: "Superseded",
};

/** Where a piece of knowledge came from. Used to resolve conflicts. */
export type KnowledgeOrigin = "human" | "roadmap" | "asset" | "meeting" | "thinking_room" | "agent";

/**
 * The source hierarchy, highest authority first. A human-approved project
 * decision outranks everything an agent inferred.
 */
export const SOURCE_RANK: Record<string, number> = {
  project_decision: 1,
  roadmap: 2,
  confirmed_knowledge: 3,
  approved_asset: 4,
  meeting: 5,
  thinking_room: 6,
  agent: 7,
};

export function rankOf(origin: KnowledgeOrigin, reviewState: KnowledgeReviewState): number {
  if (origin === "roadmap") return SOURCE_RANK["roadmap"]!;
  /* A person confirming an imported statement is the act that gives it
     authority. Where it came from stays on the record as provenance, but a
     confirmed line is no longer only a thinking room claim. */
  if (reviewState === "confirmed") return SOURCE_RANK["confirmed_knowledge"]!;
  if (origin === "asset") return SOURCE_RANK["approved_asset"]!;
  if (origin === "meeting") return SOURCE_RANK["meeting"]!;
  if (origin === "thinking_room") return SOURCE_RANK["thinking_room"]!;
  if (origin === "agent") return SOURCE_RANK["agent"]!;
  return SOURCE_RANK["confirmed_knowledge"]!;
}

export interface KnowledgeItem {
  id: ID;
  organizationId: ID;
  projectId: ID;
  section: KnowledgeSection;
  body: string;
  origin: KnowledgeOrigin;
  reviewState: KnowledgeReviewState;
  /** url, meeting id, roadmap id, file id, thinking source id. */
  sourceReference?: string;
  sourceLabel?: string;
  /** Only present when the value was inferred rather than typed by a person. */
  confidence?: number;
  capturedBy?: ID;
  capturedByLabel?: string;
  capturedAt: ISODateTime;
  supersedesId?: ID;
}

export interface KnowledgeInput {
  section: KnowledgeSection;
  body: string;
  origin?: KnowledgeOrigin;
  reviewState?: KnowledgeReviewState;
  sourceReference?: string;
  sourceLabel?: string;
  confidence?: number;
}

/** Strategic content never becomes canon on the way in. */
export function initialReviewState(origin: KnowledgeOrigin): KnowledgeReviewState {
  return origin === "human" ? "confirmed" : "needs_review";
}

/* ------------------------------------------------------------------ assets */

export type AssetType =
  "mockup" | "screenshot" | "design_reference" | "document" | "brand_asset" | "other";

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  mockup: "Mockup",
  screenshot: "Screenshot",
  design_reference: "Design reference",
  document: "Document",
  brand_asset: "Brand asset",
  other: "Other",
};

export type AssetStatus = "draft" | "reference" | "approved" | "superseded";

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  draft: "Draft",
  reference: "Reference",
  approved: "Approved",
  superseded: "Superseded",
};

export const ASSET_STATUS_TONE: Record<AssetStatus, string> = {
  draft: "border-border bg-secondary text-muted-foreground",
  reference: "border-border bg-secondary text-muted-foreground",
  approved: "border-success/25 bg-success/10 text-success",
  superseded: "border-warning/30 bg-warning/10 text-warning",
};

/**
 * An asset is metadata over a real `project_files` row. There is one file
 * system in Trust Tai and this is not a second one.
 */
export interface ProjectAsset {
  id: ID;
  organizationId: ID;
  projectId: ID;
  fileId: ID;
  assetType: AssetType;
  title: string;
  version: number;
  status: AssetStatus;
  workItemId?: ID;
  decisionId?: ID;
  uploadedBy?: ID;
  uploadedByLabel?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Uploading is never approving. */
export const DEFAULT_ASSET_STATUS: AssetStatus = "draft";

export function isImageAsset(contentType?: string): boolean {
  return typeof contentType === "string" && contentType.startsWith("image/");
}

/* ------------------------------------------------------------ connections */

export type ConnectionType = "lovable" | "github" | "staging" | "production" | "thinking" | "other";

export const CONNECTION_TYPE_LABEL: Record<ConnectionType, string> = {
  lovable: "Lovable",
  github: "GitHub",
  staging: "Staging",
  production: "Production",
  thinking: "Thinking",
  other: "Other tool",
};

/**
 * `linked` is a bookmark. `connected` means the OS can actually read or sync
 * it. Nothing may claim `connected` without a live integration behind it.
 */
export type ConnectionStatus = "linked" | "connected" | "needs_attention" | "unavailable";

export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  linked: "Linked",
  connected: "Connected",
  needs_attention: "Needs attention",
  unavailable: "Unavailable",
};

export interface ProjectConnection {
  id: ID;
  organizationId: ID;
  projectId: ID;
  connectionType: ConnectionType;
  label: string;
  url?: string;
  externalId?: string;
  status: ConnectionStatus;
  /** Written only by a real synchronisation, never by saving a URL. */
  lastSyncedAt?: ISODateTime;
  createdAt: ISODateTime;
}

export interface ConnectionInput {
  connectionType: ConnectionType;
  label: string;
  url?: string;
  externalId?: string;
}

/**
 * There is no live Lovable or GitHub integration in this repository yet, so a
 * saved URL is Linked. When a real reader exists it will write `connected`
 * together with a genuine `lastSyncedAt`.
 */
export function statusForNewConnection(): ConnectionStatus {
  return "linked";
}

export function connectionIsLive(connection: ProjectConnection): boolean {
  return connection.status === "connected" && Boolean(connection.lastSyncedAt);
}

/* ------------------------------------------------- agent effectiveness */

/**
 * Agent identity stays in `execution_agents` / Paperclip. This is only the
 * definition of what good looks like for that agent, written by a person.
 */
export interface AgentEffectiveness {
  id: ID;
  organizationId: ID;
  agentId: ID;
  responsibility: string;
  expectedWeeklyOutcomes: string[];
  successCriteria: string[];
  surfaceWhen: string[];
  requiredContext: string[];
  escalationRules: string[];
  evidenceExpected: string[];
  updatedBy?: ID;
  updatedAt: ISODateTime;
}

export interface AgentEffectivenessInput {
  agentId: ID;
  responsibility: string;
  expectedWeeklyOutcomes?: string[];
  successCriteria?: string[];
  surfaceWhen?: string[];
  requiredContext?: string[];
  escalationRules?: string[];
  evidenceExpected?: string[];
}

/** Observed, countable evidence. Never a score. */
export interface AgentEvidence {
  expectedOutcomes: number;
  completedOutcomes: number;
  acceptedRecommendations: number;
  rejectedRecommendations: number;
  correctionsRequired: number;
  humanInterventions: number;
  failedAttempts: number;
  waitingSince?: ISODateTime;
  waitingReason?: string;
  linkedOutcomes: string[];
}

export const EMPTY_AGENT_EVIDENCE: AgentEvidence = {
  expectedOutcomes: 0,
  completedOutcomes: 0,
  acceptedRecommendations: 0,
  rejectedRecommendations: 0,
  correctionsRequired: 0,
  humanInterventions: 0,
  failedAttempts: 0,
  linkedOutcomes: [],
};
