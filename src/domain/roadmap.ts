/**
 * Trust Tai OS — Roadmap contracts.
 *
 * Roadmap is the decision and sequencing layer between an opportunity or a
 * relationship and actual execution. Its one job: turn a messy situation into
 * a clear, sequenced path a client and the Trust Tai team can both act on.
 *
 * Three rules hold everywhere, the same way they do in Scout and Comms:
 *  1. Observed, inferred, and decided never blend into one sentence.
 *  2. A proposed destination stays Inferred until a person approves it.
 *  3. Weak evidence is written as Unknown, never guessed.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";

/* -------------------------------------------------------------- lifecycle */

export type RoadmapStatus =
  | "draft"
  | "proposed"
  | "approved"
  | "in_progress"
  | "complete"
  | "archived";

export const ROADMAP_STATUSES: RoadmapStatus[] = [
  "draft",
  "proposed",
  "approved",
  "in_progress",
  "complete",
  "archived",
];

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  draft: "Draft",
  proposed: "Proposed",
  approved: "Approved",
  in_progress: "In progress",
  complete: "Complete",
  archived: "Archived",
};

/** Stage states reuse the canonical Trust Tai lifecycle vocabulary. */
export type StageState = "mapped" | "in_build" | "live" | "blocked";

export const STAGE_STATES: StageState[] = ["mapped", "in_build", "live", "blocked"];

export const STAGE_STATE_LABEL: Record<StageState, string> = {
  mapped: "Mapped",
  in_build: "In build",
  live: "Live",
  blocked: "Blocked",
};

/** The epistemic tier a statement belongs to. Never blended. */
export type Tier = "observed" | "inferred" | "decided";

export const TIER_LABEL: Record<Tier, string> = {
  observed: "Observed",
  inferred: "Inferred",
  decided: "Decided",
};

/* ------------------------------------------------------------------ notes */

/** One statement, in its own tier, with what it rests on. */
export interface RoadmapNote {
  label: string;
  value: string;
  tier: Tier;
  evidence: EvidenceRef[];
  at: ISODateTime;
}

export interface Destination {
  statement: string;
  /** Inferred while proposed; decided once a person approves it. */
  tier: "inferred" | "decided";
  because: string;
  evidence: EvidenceRef[];
  approvedBy?: ID;
  approvedAt?: ISODateTime;
}

export interface NextMove {
  action: string;
  because: string;
  ownerUserId?: ID;
  ownerLabel?: string;
  tier: Tier;
}

/* --------------------------------------------------------------- roadmap */

export type RoadmapSubjectKind = "client" | "prospect" | "relationship";

export const SUBJECT_KIND_LABEL: Record<RoadmapSubjectKind, string> = {
  client: "Client",
  prospect: "Prospect",
  relationship: "Relationship",
};

export interface Roadmap {
  id: ID;
  organizationId: ID;
  clientId?: ID;
  prospectId?: ID;
  relationshipId?: ID;
  title: string;
  /** The company or person this roadmap is about, as displayed. */
  subjectLabel: string;
  objective: string;
  status: RoadmapStatus;
  ownerUserId?: ID;
  /** Point A: observed current truth only. */
  pointA: RoadmapNote[];
  /** Point B: the destination, proposed or decided. */
  pointB: Destination | null;
  nextMove: NextMove | null;
  metadata: Record<string, unknown>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RoadmapStage {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  position: number;
  title: string;
  intent?: string;
  state: StageState;
  tier: Tier;
  ownerUserId?: ID;
  ownerLabel?: string;
  evidence: EvidenceRef[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type DecisionState = "open" | "approved" | "declined" | "deferred";

export const DECISION_STATE_LABEL: Record<DecisionState, string> = {
  open: "Needs your decision",
  approved: "Approved",
  declined: "Declined",
  deferred: "Deferred",
};

export interface RoadmapDecision {
  id: ID;
  organizationId: ID;
  roadmapId: ID;
  stageId?: ID;
  question: string;
  whyItMatters: string;
  options: string[];
  recommendation?: string;
  recommendationBecause?: string;
  evidence: EvidenceRef[];
  ownerUserId?: ID;
  status: DecisionState;
  resolutionNote?: string;
  resolvedBy?: ID;
  resolvedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** A roadmap with everything the workspace needs to render it. */
export interface RoadmapDetail {
  roadmap: Roadmap;
  stages: RoadmapStage[];
  decisions: RoadmapDecision[];
}

/** The phrase used anywhere evidence is too weak to state something. */
export const UNKNOWN_STATEMENT = "Unknown — needs confirmation";

export function isOpen(decision: RoadmapDecision): boolean {
  return decision.status === "open";
}

/** Roadmaps still moving. Used by Home to separate active from finished. */
export function isActiveRoadmap(roadmap: Roadmap): boolean {
  return (
    roadmap.status !== "complete" &&
    roadmap.status !== "archived"
  );
}

/** Stage ordering is positional and stable; ties fall back to creation time. */
export function orderStages(stages: RoadmapStage[]): RoadmapStage[] {
  return [...stages].sort(
    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
  );
}
