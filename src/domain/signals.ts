/**
 * Trust Tai OS — shared context and signal contracts (Intelligence, layer 3).
 *
 * Intelligence reads broadly and writes narrowly. It may assemble context,
 * notice a signal, explain it, and recommend a next move. It never changes
 * another room's source-of-truth state: every signal points at the app that
 * owns the change, and a person decides.
 *
 * Nothing here may state something the evidence does not support. An empty
 * result is a truthful result.
 */

import type { ConfidenceLevel, EvidenceRef } from "./confidence";
import type { EntityRef, ID, ISODateTime } from "./entities";

/** Which room a fact came from. */
export type ContextSourceApp =
  | "scout"
  | "comms"
  | "roadmap"
  | "projects"
  | "studio"
  | "ops"
  /** Conversations, commitments and role memory, owned by Steward. */
  | "steward";

/** Observed = read. Inferred = worked out. Decided = a person committed to it. */
export type TruthTier = "observed" | "inferred" | "decided";

export const TRUTH_TIER_LABEL: Record<TruthTier, string> = {
  observed: "Observed",
  inferred: "Inferred",
  decided: "Decided",
};

/** One retrieved fact, always with a room, a tier, and where it came from. */
export interface ContextBlock {
  id: ID;
  appId: ContextSourceApp;
  /** The shared entity the fact is about. */
  entity: EntityRef;
  fact: string;
  tier: TruthTier;
  evidence: EvidenceRef[];
  at: ISODateTime;
  /** Whole days between `at` and the moment context was assembled. */
  stalenessDays: number;
  confidence?: ConfidenceLevel;
}

export interface WithheldSource {
  appId: string;
  reason: "unauthorized" | "not_connected" | "no_data";
}

export interface ContextBundle {
  organizationId: ID;
  subject?: EntityRef;
  question?: string;
  blocks: ContextBlock[];
  /** Rooms that actually contributed at least one block. */
  contributingApps: ContextSourceApp[];
  withheld: WithheldSource[];
  generatedAt: ISODateTime;
}

/* ----------------------------------------------------------------- signals */

export type SignalCategory =
  | "client_stewardship"
  | "pipeline"
  | "delivery"
  | "relationship"
  | "pattern"
  | "growth"
  /** Technical risk observed by Ops, the specialist room. */
  | "technical_risk"
  /** Follow-through on what people promised, owned by Steward. */
  | "stewardship";

export const SIGNAL_CATEGORY_LABEL: Record<SignalCategory, string> = {
  client_stewardship: "Client stewardship",
  pipeline: "Pipeline",
  delivery: "Delivery",
  relationship: "Relationship",
  pattern: "Pattern",
  growth: "Growth",
  technical_risk: "Technical risk",
  stewardship: "Stewardship",
};

/** Where the work actually happens. Intelligence only routes there. */
export interface SignalDestination {
  appId: string;
  label: string;
  route: string;
}

/**
 * v1 signals are derived on read, not persisted. Status is carried so the
 * shape does not change when acknowledgement is added later.
 */
export type SignalStatus = "new" | "acknowledged" | "resolved";

export interface Signal {
  id: ID;
  category: SignalCategory;
  title: string;
  /** Why it matters, in one plain sentence. */
  why: string;
  subject?: EntityRef;
  evidence: EvidenceRef[];
  /** Context block ids this signal rests on. Never empty. */
  contextRefs: ID[];
  confidence: ConfidenceLevel;
  recommendedNextMove: string;
  destination: SignalDestination;
  status: SignalStatus;
  /** Sort weight. Higher is more urgent. Derived, never typed in. */
  urgency: number;
  at: ISODateTime;
}

/* --------------------------------------------------------------- questions */

export type AskQuestionId = "attention_today" | "company_across_suite" | "what_next";

export interface AskAnswer {
  questionId: AskQuestionId;
  question: string;
  /** One sentence. Says plainly when the evidence is not there. */
  headline: string;
  /** Whether the retrieved evidence supports an answer at all. */
  sufficient: boolean;
  signals: Signal[];
  blocks: ContextBlock[];
  contributingApps: ContextSourceApp[];
  withheld: WithheldSource[];
  generatedAt: ISODateTime;
}
