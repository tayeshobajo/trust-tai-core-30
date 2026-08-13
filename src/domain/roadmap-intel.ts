/**
 * Trust Tai OS — Roadmap Intelligence v2 contracts.
 *
 * Roadmap v1 sequenced work. v2 researches the business first, forms a point of
 * view, and only then proposes what Trust Tai could build.
 *
 * The truth model does not bend:
 *   Observed = a sourced fact, with a URL and a checked_at.
 *   Inferred = a research deduction or a proposal.
 *   Decided  = a human said yes, in Trust Tai OS, on the record.
 *   Unknown  = written down as missing rather than guessed.
 *
 * Nothing here promotes Inferred to Decided. Only a person does that, through
 * an explicit action that is recorded in history.
 */

import type { ConfidenceLevel } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { Tier } from "./roadmap";

/* ------------------------------------------------------------------ sources */

/**
 * A public claim's receipt. A research claim cannot be Observed without one:
 * where it was read, when it was checked, and which provider read it.
 */
export interface SourceRef {
  label: string;
  url: string;
  checkedAt: ISODateTime;
  provider?: string;
  model?: string;
}

export const UNKNOWN = "Unknown — not established";

/* ----------------------------------------------------------------- research */

export type ResearchStatus = "pending" | "running" | "complete" | "failed";

/** One researched statement, in its own tier, with what it rests on. */
export interface ResearchClaim {
  statement: string;
  tier: Tier;
  confidence: ConfidenceLevel;
  sources: SourceRef[];
}

export interface ResearchCompetitor {
  name: string;
  website?: string;
  /** How they position, not a feature list to copy. */
  positioning: string;
  tier: Tier;
  confidence: ConfidenceLevel;
  sources: SourceRef[];
}

export interface RoadmapResearch {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  status: ResearchStatus;
  /** How the business makes money and who it serves. */
  companyModel: ResearchClaim[];
  buyers: ResearchClaim[];
  /** What leadership has already built. Recognised, never re-invented. */
  strengths: ResearchClaim[];
  digitalPresence: ResearchClaim[];
  competitors: ResearchCompetitor[];
  marketDirection: ResearchClaim[];
  sources: SourceRef[];
  unknowns: string[];
  provider?: string;
  model?: string;
  /** When the public web was last read for this subject. */
  checkedAt?: ISODateTime;
  error?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** How stale a research pass is, in plain language. */
export function freshness(checkedAt: string | undefined, now = new Date()): string {
  if (!checkedAt) return "Never researched";
  const then = new Date(checkedAt).getTime();
  if (Number.isNaN(then)) return "Never researched";
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days <= 0) return "Checked today";
  if (days === 1) return "Checked yesterday";
  if (days < 30) return `Checked ${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "Checked a month ago" : `Checked ${months} months ago`;
}

/* ----------------------------------------------------------------- strategy */

export type ApprovalState = "proposed" | "approved" | "rejected" | "deferred";

export const APPROVAL_LABEL: Record<ApprovalState, string> = {
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  deferred: "Deferred",
};

/** One strategic statement a person can approve, reject, or defer. */
export interface StrategyItem {
  key: string;
  statement: string;
  because: string;
  tier: Tier;
  confidence: ConfidenceLevel;
  sources: SourceRef[];
  approval: ApprovalState;
  approvedBy?: ID;
  approvedAt?: ISODateTime;
}

export interface HorizonBand {
  years: 2 | 5 | 10;
  statement: string;
  tier: Tier;
  confidence: ConfidenceLevel;
  sources: SourceRef[];
}

export interface RoadmapStrategy {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  /** Observed current truth, carried forward from research. */
  pointA: StrategyItem[];
  /** One to three things this company is already provably good at. */
  anchorProof: StrategyItem[];
  horizon: HorizonBand[];
  pointB: StrategyItem | null;
  pointC: StrategyItem | null;
  centralTruth: StrategyItem | null;
  gaps: StrategyItem[];
  leveragePoint: StrategyItem | null;
  provider?: string;
  model?: string;
  generatedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Only an approved item may be built on. */
export function isApproved(item: StrategyItem | null | undefined): boolean {
  return Boolean(item && item.approval === "approved" && item.tier === "decided");
}

/* --------------------------------------------------------------- milestones */

export type MilestoneStatus =
  | "candidate"
  | "shortlisted"
  | "approved"
  | "rejected"
  | "deferred";

export const MILESTONE_STATUSES: MilestoneStatus[] = [
  "candidate",
  "shortlisted",
  "approved",
  "rejected",
  "deferred",
];

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  candidate: "Candidate",
  shortlisted: "Shortlisted",
  approved: "Approved",
  rejected: "Rejected",
  deferred: "Deferred",
};

export interface RoadmapMilestone {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  name: string;
  /** The asset or capability Trust Tai would actually build. */
  whatWeBuild: string;
  intendedUser: string;
  supportingMarketDirection: string;
  clientAdvantage: string;
  currentGap: string;
  evidence: SourceRef[];
  immediateValue: string;
  longTermValue: string;
  dependencies: string[];
  executionBoundary: string;
  confidence: ConfidenceLevel;
  /** Derived, never typed in. */
  priorityScore: number;
  priorityRationale: string[];
  recommendedSequence: number;
  status: MilestoneStatus;
  tier: Tier;
  ownerUserId?: ID;
  ownerLabel?: string;
  decisionNote?: string;
  decidedBy?: ID;
  decidedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Build Order shows Decided work only. Nothing else can enter it. */
export function isBuildOrderReady(milestone: RoadmapMilestone): boolean {
  return milestone.status === "approved" && milestone.tier === "decided";
}

/* ---------------------------------------------------------------- artifacts */

export type ArtifactKind = "preview" | "full";

export interface ArtifactSection {
  key: string;
  title: string;
  /** Paragraphs. Every sentence traces to stored evidence or says Unknown. */
  body: string[];
  tier: Tier;
  sources: SourceRef[];
  /** What the page should look like. Direction, not a promise of an asset. */
  visualDirection?: string;
  caption?: string;
  /** Milestone pages carry "What It Unlocks". */
  unlocks?: string[];
}

export interface RoadmapArtifact {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  kind: ArtifactKind;
  title: string;
  sections: ArtifactSection[];
  /** Client accent, only when a validated brand colour is already on record. */
  accent?: string;
  logoUrl?: string;
  /** Who wrote it. Studio is model backed, so this is never left implied. */
  provider?: string;
  model?: string;
  /** Lines the validator refused because approved evidence did not back them. */
  rejected: { section: string; line: string; reason: string; severity?: string }[];
  /** True once a person has edited the composed document by hand. */
  humanEdited: boolean;
  /** Increments on every composition and every hand edit. History is a table. */
  version: number;
  editedAt?: ISODateTime;
  editedBy?: ID;
  generatedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}


/* -------------------------------------------------------------- walkthrough */

export type WalkthroughEntryKind =
  | "note"
  | "approval"
  | "rejection"
  | "change"
  | "question"
  | "next_action";

export const WALKTHROUGH_KIND_LABEL: Record<WalkthroughEntryKind, string> = {
  note: "Note",
  approval: "Approved in the room",
  rejection: "Rejected in the room",
  change: "Change requested",
  question: "Unanswered question",
  next_action: "Next action",
};

export interface WalkthroughEntry {
  kind: WalkthroughEntryKind;
  body: string;
  at: ISODateTime;
  milestoneId?: ID;
  authorId?: ID;
}

export interface RoadmapSession {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  entries: WalkthroughEntry[];
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------ ask (grounded) */

export interface AskAnswer {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  question: string;
  /** Sourced statements only. */
  facts: { statement: string; sources: SourceRef[] }[];
  /** Reasoning on top of those facts, labelled as reasoning. */
  inferences: string[];
  unknowns: string[];
  answer: string;
  provider?: string;
  model?: string;
  createdAt: ISODateTime;
}
