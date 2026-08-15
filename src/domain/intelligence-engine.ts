/**
 * Trust Tai OS — Intelligence Engine contracts.
 *
 * The engine is the suite's steward. It reads broadly, notices structural
 * facts about the business rather than about a person, forms a small number of
 * honest readings, proposes bounded next moves, and learns from what people
 * did with those proposals.
 *
 * Laws encoded here rather than hoped for:
 *
 *   - Read broadly, write narrowly. The engine owns no canonical entity. Every
 *     recommendation names the room that owns the change.
 *   - Nothing is asserted without evidence. An artefact with no observation
 *     behind it is not produced.
 *   - Observed / Inferred / Decided survives end to end. A decided belief
 *     silences a contradicting inference rather than arguing with it.
 *   - Silence is a valid answer. Zero recommendations is a result, not a bug.
 *   - Volume is bounded at every stage. Over-notification is a defect.
 */

import type { ConfidenceLevel, EvidenceRef } from "./confidence";
import type { EntityRef, ID, ISODateTime } from "./entities";
import type { TruthTier } from "./signals";

/* ------------------------------------------------------------------ themes */

/**
 * The vocabulary the engine reasons in. Deliberately small: these are the
 * shapes of business health a services business actually lives or dies by.
 * A theme is not a rule — it says which observations belong together.
 */
export type BusinessTheme =
  /** Is there work to do at all? */
  | "capacity"
  /** Is the work we have moving? */
  | "delivery"
  /** Is anything coming? */
  | "pipeline"
  /** Did we do what we said we would? */
  | "follow_through"
  /** Does the same thing keep going wrong? */
  | "friction"
  /** Is a client quietly drifting away? */
  | "client_risk"
  /** Is something good happening that nobody has named? */
  | "opportunity";

export const BUSINESS_THEME_LABEL: Record<BusinessTheme, string> = {
  capacity: "Capacity",
  delivery: "Delivery",
  pipeline: "Pipeline",
  follow_through: "Follow-through",
  friction: "Recurring friction",
  client_risk: "Client risk",
  opportunity: "Opportunity",
};

/* ------------------------------------------------------------- observation */

/**
 * One deterministic, dated read about the business.
 *
 * Business-level counterpart to `ContextBlock`, which is per entity. An
 * observation is a count, a date or a state — never an interpretation. If it
 * contains the word "because", it belongs in a hypothesis instead.
 */
export interface Observation {
  id: ID;
  theme: BusinessTheme;
  /** Stable machine name, e.g. "no_active_project". Used for learning. */
  kind: string;
  /** Plain language, no interpretation. "No project is open in Projects." */
  statement: string;
  tier: TruthTier;
  /** The number the statement rests on, when the read is a count. */
  magnitude?: number;
  subject?: EntityRef;
  evidence: EvidenceRef[];
  /** Context block ids from `contextBlocks()`, when the read maps to entities. */
  contextRefs: ID[];
  /** Rooms this read came from. */
  sourceApps: string[];
  at: ISODateTime;
}

/* -------------------------------------------------------------- hypothesis */

/**
 * A possible reading of several observations. Always inferred: a hypothesis is
 * never decided truth, however obvious it looks.
 */
export interface Hypothesis {
  id: ID;
  theme: BusinessTheme;
  /** What might be true, in one sentence. */
  claim: string;
  /** Why the engine thinks so, from the observations only. */
  because: string;
  confidence: ConfidenceLevel;
  /** Observation ids. Never empty — that is what makes it checkable. */
  observationRefs: ID[];
  /** Rooms the supporting observations came from. */
  sourceApps: string[];
  /** Observations that argue against this reading, when any exist. */
  contradicts?: ID[];
  /** Stable shape of the reading, so feedback counts against the shape. */
  patternKey: string;
  /** Whether a model expressed it, or deterministic code did. */
  origin: "derived" | "reasoned";
  at: ISODateTime;
}

/* ---------------------------------------------------------- recommendation */

export type RecommendationKind =
  /** A move inside an existing room. */
  | "move"
  /** A piece of deliberate outbound or relationship work. */
  | "campaign"
  /** A capability worth building: an app, a workflow, an automation. */
  | "system"
  /** A cheap, bounded thing to try, to learn something. */
  | "experiment";

export const RECOMMENDATION_KIND_LABEL: Record<RecommendationKind, string> = {
  move: "Next move",
  campaign: "Campaign",
  system: "System to build",
  experiment: "Experiment",
};

export type RecommendationEffort = "small" | "medium" | "large";

export interface RecommendationDestination {
  appId: string;
  label: string;
  route: string;
}

export interface Recommendation {
  id: ID;
  kind: RecommendationKind;
  theme: BusinessTheme;
  headline: string;
  /** Why now, in one plain sentence, drawn from the hypotheses. */
  rationale: string;
  hypothesisRefs: ID[];
  observationRefs: ID[];
  confidence: ConfidenceLevel;
  effort: RecommendationEffort;
  /**
   * What should become observably true if this worked. A proposal whose
   * success could not be observed is never shown: it cannot be learned from.
   */
  expectedSignal: string;
  /** The observation kind whose movement will answer for it. */
  expectedSignalKind: string;
  destination: RecommendationDestination;
  /** Rooms the evidence came from. Two or more for anything actionable. */
  sourceApps: string[];
  patternKey: string;
  /** Ordering only. Never displayed, never a score of a person. */
  order: number;
  at: ISODateTime;
}

/* --------------------------------------------------------- action proposal */

/**
 * The bounded, reversible unit an owning app could execute.
 *
 * v1 ships proposals only: a person opens the room and does the thing. The
 * shape exists now so nothing has to change when an app can accept one.
 */
export interface ActionProposal {
  id: ID;
  recommendationId: ID;
  appId: string;
  /** e.g. "comms.draft_reply". Always an operation the owning app already has. */
  operation: string;
  payload: Record<string, unknown>;
  reversible: boolean;
  /** Always true in v1. There is no silent path to action. */
  requiresApproval: true;
}

/* ----------------------------------------------------------------- outcome */

export type RecommendationDecision = "accepted" | "edited" | "rejected" | "deferred";

export const RECOMMENDATION_DECISION_LABEL: Record<RecommendationDecision, string> = {
  accepted: "Accepted",
  edited: "Edited, then accepted",
  rejected: "Rejected",
  deferred: "Deferred",
};

export type ObservedResult = "signal_improved" | "no_change" | "worsened" | "unknown";

export interface RecommendationOutcome {
  id: ID;
  recommendationId: ID;
  patternKey: string;
  decision: RecommendationDecision;
  editedText?: string;
  observedResult?: ObservedResult;
  decidedBy: string;
  at: ISODateTime;
}

/* ------------------------------------------------------------ engine reads */

/** What the engine hands a surface. Honest when it is empty. */
export interface EngineRead {
  organizationId: ID;
  /** One sentence for the top of Pulse. Says plainly when all is well. */
  headline: string;
  observations: Observation[];
  hypotheses: Hypothesis[];
  recommendations: Recommendation[];
  /** Rooms that contributed nothing, and why. Carried from the snapshot. */
  withheld: { appId: string; reason: string }[];
  /** Patterns a person has told the engine to stop raising. */
  suppressed: string[];
  /** Patterns a person accepted before. Ordering only. */
  favoured: string[];
  /** Human-decided statements the read was checked against. Shown on request. */
  decided: string[];
  /** Whether a model contributed. False means deterministic-only, and honest. */
  reasoned: boolean;
  generatedAt: ISODateTime;
}

/* -------------------------------------------------------------------- caps */

/** At most this many recommendations may be live at once. */
export const MAX_RECOMMENDATIONS = 3;

/** At most this many hypotheses are shown; the rest stay countable. */
export const MAX_HYPOTHESES = 5;

/** Home may carry one recommendation. Never more. */
export const MAX_HOME_RECOMMENDATIONS = 1;

/**
 * A recommendation that touches only one room is a hunch, and is labelled as
 * one. Anything that claims to be actionable cites two rooms or more.
 */
export const MIN_ROOMS_FOR_ACTIONABLE = 2;

/**
 * A structural need must repeat across this many distinct canonical sources
 * before the engine will propose building something. Same threshold as
 * Steward's recurring-pattern law, and for the same reason.
 */
export const STRUCTURAL_NEED_THRESHOLD = 3;

/** Confidence can be lowered by context, never raised past its evidence. */
export function confidenceFromEvidence(input: {
  observationCount: number;
  roomCount: number;
  stalenessDays: number;
}): ConfidenceLevel {
  if (input.observationCount === 0) return "unknown";
  if (input.stalenessDays > 60) return "low";
  if (input.observationCount >= 3 && input.roomCount >= 2) return "high";
  if (input.observationCount >= 2 && input.roomCount >= 2) return "moderate";
  if (input.observationCount >= 2) return "moderate";
  return "low";
}

export function engineHeadline(count: number): string {
  if (count === 0) return "Nothing about the business needs a decision from you right now.";
  if (count === 1) return "One thing about the business is worth deciding.";
  return `${count} things about the business are worth deciding.`;
}
