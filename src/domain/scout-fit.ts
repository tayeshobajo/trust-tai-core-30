/**
 * Scout, ICP fit evaluation contract.
 *
 * Fit is deterministic, explainable, and conservative. It is NOT AI scoring:
 * every criterion states what was read, from where, and why it landed where it
 * did. Unknown is never treated as a mismatch.
 *
 * Traffic-light colour describes ICP FIT only. Workflow stage is separate and
 * never coloured.
 */

export type FitLight = "green" | "yellow" | "red" | "neutral";

export type FitCriterionState = "met" | "partial" | "missing" | "mismatch";

export interface FitCriterion {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  state: FitCriterionState;
  /** Plain-language explanation of what was read, or what was not found. */
  reason: string;
  sourceUrls?: string[];
}

/**
 * Opportunity gap: business momentum measured against digital maturity.
 * "high" means a healthy, moving business whose digital presence has fallen
 * behind, which is exactly who Trust Tai serves. "low" means the digital
 * presence is already strong or the company can build for itself. "unknown"
 * means the evidence is not there yet, and unknown is never guessed over.
 */
export type OpportunityGapLevel = "high" | "medium" | "low" | "unknown";

export interface OpportunityGapRead {
  gap: OpportunityGapLevel;
  /** Evidence the business itself is healthy and moving. */
  momentumEvidence: string[];
  /** Evidence about the state of the digital presence, weak or strong. */
  maturityEvidence: string[];
}

export interface ScoutFitEvaluation {
  /** 0–100. Null-safe: preview rows are still scored 0 with a neutral light. */
  score: number;
  light: FitLight;
  /** Distinct, meaningful evidence points behind the score. */
  evidenceCount: number;
  strongestSignal: string;
  criteria: FitCriterion[];
  /** ICP version the evaluation was made against, when one is active. */
  icpVersion: number | null;
  evaluatorVersion: string;
  evaluatedAt: string;
  /** Why the light is what it is, in one calm sentence. */
  explanation: string;
  /** True when the row cannot honestly be scored against live evidence. */
  scoreable: boolean;
  /** Public pages read. Confidence context only, never ICP fit points. */
  pagesResearched?: number;
  /** e.g. "5 public pages checked" or "Research depth is thin". */
  researchDepthNote?: string;
  /** `provenance.research_version` reported by the backend, when present. */
  researchVersion?: number;
  /** Momentum vs digital maturity, derived from the same stored evidence. */
  opportunityGap?: OpportunityGapRead;
}

export const SCOUT_EVALUATOR_VERSION = "trust-tai-icp-v4";
