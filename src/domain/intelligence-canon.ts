/**
 * Trust Tai OS, the Intelligence Canon contract.
 *
 * The suite already notices what happened. The canon is how it recognises
 * *what kind of situation* it is looking at, and how a resolved situation
 * makes the next reading better.
 *
 * Laws encoded here rather than hoped for:
 *
 *   - A pattern produces a hypothesis, never a declaration. Every pattern
 *     carries competing explanations and a confidence cap.
 *   - Evidence lanes survive matching. A match reports the tier of every fact
 *     it stands on and can never promote stated testimony to observed fact.
 *   - Missing evidence is part of the answer. A pattern that matched on two of
 *     five conditions says which three are absent.
 *   - Learning never expands authority, and one outcome is never a rule.
 *     Canonical pattern text changes only through a governed revision.
 *   - The canon owns no business entity. Cases reference rooms by id; they
 *     never copy a prospect, project, message or transcript.
 */

import type { ConfidenceLevel, EvidenceRef } from "./confidence";
import type { EntityRef, ID, ISODateTime } from "./entities";
import type { TruthTier } from "./signals";

/* ----------------------------------------------------------------- domains */

/** The areas of the business the canon reasons about. Deliberately few. */
export type CanonDomain =
  | "delivery"
  | "client"
  | "founder"
  | "pipeline"
  | "roadmap"
  | "website"
  | "commitments"
  | "business_health";

export const CANON_DOMAIN_LABEL: Record<CanonDomain, string> = {
  delivery: "Projects and delivery",
  client: "Client relationship",
  founder: "Founder and team",
  pipeline: "Scout and pipeline",
  roadmap: "Roadmap",
  website: "Website",
  commitments: "Commitments",
  business_health: "Business health",
};

export type CanonStatus = "active" | "draft" | "deprecated";

/* ---------------------------------------------------------------- triggers */

/**
 * One checkable condition over what the suite already observed.
 *
 * `observationKind` is an engine observation kind, so a condition is always
 * answerable from evidence the suite produced itself. `minMagnitude` reads the
 * count behind that observation, when the observation carries one.
 */
export interface PatternCondition {
  /** Engine observation kind, e.g. "project_delayed". */
  observationKind: string;
  /** Plain language, so a person can see what was being looked for. */
  looksFor: string;
  /** Smallest count that satisfies the condition, when a count applies. */
  minMagnitude?: number;
  /** A condition that is helpful but not required for the shape to hold. */
  optional?: boolean;
}

/** Evidence the suite cannot see yet, named so a person can go and look. */
export interface EvidenceRequest {
  /** What to inspect, in a person's language. */
  inspect: string;
  /** The room that holds it. */
  appId: string;
  /** What would confirm the reading, and what would kill it. */
  wouldConfirm: string;
  wouldRefute: string;
}

export interface CompetingExplanation {
  /** The other thing this could be. */
  explanation: string;
  /** What would tell the two apart. */
  distinguishedBy: string;
}

/* ----------------------------------------------------------------- pattern */

export interface IntelligencePattern {
  id: ID;
  domain: CanonDomain;
  name: string;
  /** What you see, in one sentence. */
  description: string;
  /** What it may mean. Never "is". */
  mayMean: string;
  triggers: PatternCondition[];
  /** Facts whose presence argues the shape is something else. */
  negativeIndicators: PatternCondition[];
  /** Ranked possible causes. Hypotheses, not findings. */
  hypotheses: string[];
  competingExplanations: CompetingExplanation[];
  evidenceToInspect: EvidenceRequest[];
  /** The most this pattern may ever claim, however many triggers fire. */
  confidenceCap: ConfidenceLevel;
  /** Diagnostic chain to run before treating the reading as real. */
  chainId?: ID;
  /** Bounded moves, each named with the room that owns it. */
  possibleNextMoves: { move: string; appId: string }[];
  /** How a person would know later whether the reading was right. */
  verifyOutcomeBy: string;
  /** Where the pattern came from. */
  source: "trust_tai_canon" | "case_derived" | "human_authored";
  version: number;
  status: CanonStatus;
}

/* --------------------------------------------------------- diagnostic chain */

export type DiagnosticCheckKind =
  /** Answerable from suite evidence. */
  | "evidence"
  /** Only a person can answer it. */
  | "human";

export interface DiagnosticCheck {
  id: ID;
  /** The question, asked the way a person would ask it. */
  question: string;
  kind: DiagnosticCheckKind;
  /** Observation kinds that answer it, when the suite can. */
  requiredEvidence: string[];
  /** The room to look in. */
  appId: string;
  /** Where the answer sends you next. */
  branches: {
    when: string;
    /** Next check id, or nothing when this branch ends the chain. */
    next?: ID;
    /** The reading this branch supports, when it ends the chain. */
    hypothesis?: string;
  }[];
}

export interface DiagnosticChain {
  id: ID;
  domain: CanonDomain;
  /** The question a person actually asks. */
  question: string;
  /** When it is worth running. */
  trigger: string;
  checks: DiagnosticCheck[];
  /** When to stop, even unfinished. Silence is a valid end. */
  stopConditions: string[];
  /** The readings this chain can end on. */
  hypothesisCandidates: string[];
  /** What to ask for when the chain runs out of evidence. */
  nextEvidenceRequest: EvidenceRequest[];
  version: number;
  status: CanonStatus;
}

/* ------------------------------------------------------------------- match */

/** One fact a match stands on, with its lane intact. */
export interface MatchedEvidence {
  observationId: ID;
  observationKind: string;
  statement: string;
  /** The lane the fact arrived in. Matching never changes it. */
  tier: TruthTier;
  magnitude?: number;
  sourceApps: string[];
}

export interface PatternMatch {
  patternId: ID;
  patternName: string;
  domain: CanonDomain;
  /** 0 to 1, deterministic. Ordering and thresholds only, never shown as a percentage. */
  score: number;
  /** Why it matched, in one sentence. */
  because: string;
  matched: MatchedEvidence[];
  /** Required conditions that found nothing. */
  missingEvidence: EvidenceRequest[];
  /** Conditions the suite could check but that did not fire. */
  unmetConditions: string[];
  /** Facts that argue against the reading. */
  contradicting: MatchedEvidence[];
  competingExplanations: CompetingExplanation[];
  recommendedChainId?: ID;
  /** Never above the pattern's cap, and lowered further by thin evidence. */
  confidence: ConfidenceLevel;
  possibleNextMoves: { move: string; appId: string }[];
  /** A short label a surface may show, e.g. "Possible founder bottleneck". */
  label: string;
  evidence: EvidenceRef[];
}

/* -------------------------------------------------------------------- case */

export type CaseDiagnosisVerdict = "correct" | "partly_correct" | "incorrect" | "unknown";

export interface IntelligenceCase {
  id: ID;
  organizationId: ID;
  patternId: ID;
  patternVersion: number;
  /** Rooms and records the situation involved. References only. */
  entities: EntityRef[];
  /**
   * Pointers to the evidence as it stood, never a copy of room state:
   * observation ids, activity event ids, signal ids.
   */
  evidenceRefs: { kind: "observation" | "activity" | "signal"; id: ID }[];
  hypothesis: string;
  /** What the person decided, in their words. */
  humanDecision: string;
  decidedBy: ID;
  decidedAt: ISODateTime;
  /** What actually happened, once it could be seen. */
  outcome?: string;
  outcomeAt?: ISODateTime;
  diagnosisVerdict: CaseDiagnosisVerdict;
  /** The person's correction, when the reading was wrong. Outranks inference. */
  correction?: string;
  /** One sentence the next diagnosis should carry. */
  lesson?: string;
  createdAt: ISODateTime;
}

/* --------------------------------------------------------- outcome learning */

export type PatternResult = "success" | "failure" | "unknown";

export interface PatternOutcome {
  id: ID;
  organizationId: ID;
  patternId: ID;
  patternVersion: number;
  caseId?: ID;
  /** The recommendation that was made off the back of the match. */
  recommendation: string;
  /** What the person did with it. */
  decision: "accepted" | "edited" | "deferred" | "rejected";
  /** What was found later, in the owning room. */
  result: PatternResult;
  resultBecause: string;
  /** Whole hours from decision to observed outcome, when both are known. */
  hoursToOutcome?: number;
  /** Where the result came from. Absent on older rows, which read as human. */
  resultSource?: OutcomeSource;
  /** Room-native references the result stands on, never copied room state. */
  sourceRefs?: string[];
  /** When the state or event behind the result was read. */
  observedAt?: ISODateTime;
  /** A person's correction outranks anything inferred from the result. */
  humanCorrection?: string;
  recordedBy: ID;
  recordedAt: ISODateTime;
}

/** How an outcome was established. Human recorded is the strongest. */
export type OutcomeSource = "human" | "room_event" | "current_state" | "room_state";

export const OUTCOME_SOURCE_LABEL: Record<OutcomeSource, string> = {
  human: "Human recorded",
  room_event: "Room event confirmed",
  current_state: "Current state confirmed",
  room_state: "Owning room state confirmed",
};


/** Repeated evidence, never a single result, may change guidance. */
export const PATTERN_LESSON_THRESHOLD = 3;

/**
 * A proposed change to canonical pattern text. Nothing applies it
 * automatically: a pattern revision is a governed, human act.
 */
export interface PatternRevisionProposal {
  patternId: ID;
  fromVersion: number;
  /** What the outcomes suggest, in one sentence. */
  suggestion: string;
  /** The outcome ids behind it. */
  outcomeRefs: ID[];
  /** Always true. There is no automatic canon edit. */
  requiresApproval: true;
}

/* ------------------------------------------------ proposal governance */

/** What a person did with a revision proposal. Final for that fingerprint. */
export type ProposalDecisionKind = "accepted" | "rejected" | "deferred";

export const PROPOSAL_DECISION_LABEL: Record<ProposalDecisionKind, string> = {
  accepted: "Accept",
  rejected: "Reject",
  deferred: "Defer",
};

/**
 * A person's answer to one revision proposal.
 *
 * Append only, and never an edit to canon text. Accepting authorises a future
 * canon revision review; the pattern a room reads today is unchanged until a
 * versioned change ships.
 */
export interface PatternRevisionDecision {
  id: ID;
  organizationId: ID;
  patternId: ID;
  patternVersion: number;
  /** Content identity of the proposal this answers. */
  proposalFingerprint: string;
  proposalText: string;
  outcomeRefs: ID[];
  decision: ProposalDecisionKind;
  note?: string;
  decidedBy: ID;
  decidedAt: ISODateTime;
}

/* --------------------------------------------------- experience health */

/** Whether the organization is actually accumulating experience. Counts only. */
export interface ExperienceHealth {
  since: ISODateTime;
  casesOpened: number;
  casesResolved: number;
  corrections: number;
  patternsWithEnoughOutcomes: number;
  proposalsAwaitingDecision: number;
  /** Whole days, or null when nothing is open. */
  oldestOpenCaseDays: number | null;
  /** Open cases the scheduler could actually check against current state. */
  casesCheckedAutomatically: number;
  /** Of those, the ones a deterministic check settled without a person. */
  casesResolvedAutomatically: number;
  /** Open cases that stayed unknown after checking. Not a failure. */
  casesUnknownAfterChecks: number;
}
