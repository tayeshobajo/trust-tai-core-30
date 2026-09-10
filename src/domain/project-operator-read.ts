/**
 * Projects: the operator read contract.
 *
 * The question Projects asks the runtime before a milestone is executable:
 * "What does an experienced operator need to know about this milestone before
 * it is executable?" Not a summary, a working read: what is missing, what
 * the suite has seen before, what could go wrong, what must be true first,
 * how the work will be judged, and who can actually do it.
 *
 * This file is the domain contract. The composition, building the
 * ReasoningRequest from a ProjectContextPacket and folding the RuntimeRead
 * back into this shape, lives in src/data/projects/operator-read.ts.
 *
 * The read never executes anything. It prepares a person (or, with approval,
 * an owning adapter) to execute well.
 */

import type { ConfidenceLevel } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { CompletionEvidenceKind } from "./intelligence-runtime";

/** Evidence the operator read is allowed to draw on. */
export type OperatorEvidenceKind = "meeting" | "file" | "context_packet" | "decision" | "activity";

export interface OperatorEvidenceRef {
  kind: OperatorEvidenceKind;
  /** Where it lives: a conversation id, file id, packet ref, decision id. */
  ref: string;
  label: string;
}

/** What is missing before the milestone can be executed well. */
export interface OperatorGap {
  missing: string;
  /** Why it matters for this milestone, in one sentence. */
  whyItMatters: string;
  /** The evidence that would close it, when known. */
  closesWith?: OperatorEvidenceKind;
}

/** Knowledge the suite already holds that applies here. */
export interface OperatorKnowledge {
  kind: "canon_pattern" | "diagnostic_chain" | "prior_case" | "human_correction";
  id: string;
  label: string;
  /** How it applies to this milestone, in one sentence. */
  applies: string;
}

export interface OperatorRisk {
  risk: string;
  because: string;
  /** The evidence refs the risk rests on. Never an invention. */
  restsOn: string[];
}

export interface OperatorDependency {
  dependsOn: string;
  owner: string;
  state: "met" | "open" | "unknown";
}

/** How the milestone's completion will be judged, proposed, not assumed. */
export interface OperatorAcceptanceCriterion {
  criterion: string;
  evidenceKind: CompletionEvidenceKind;
}

/**
 * Whether the room's declared capabilities fit this milestone, and where the
 * work would go if they do not. External execution (Paperclip) is named
 * honestly as outside the suite.
 */
export interface OperatorCapabilityFit {
  /** Operations in the Projects registry that fit this work. */
  fits: string[];
  /** Gaps: what the work needs that no in-suite capability covers. */
  gaps: string[];
  /** External execution surfaces the work would touch. */
  external: string[];
}

/**
 * The operator read itself. Everything in it cites evidence or knowledge the
 * suite actually holds; anything the suite cannot ground appears in
 * missingContext instead of being filled in.
 */
export interface ProjectOperatorRead {
  projectId: ID;
  milestoneId: string;
  /** What an experienced operator needs to know, in one paragraph at most. */
  operatorSummary: string;
  facts: { statement: string; evidenceRefs: string[] }[];
  missingContext: OperatorGap[];
  patternKnowledge: OperatorKnowledge[];
  risks: OperatorRisk[];
  dependencies: OperatorDependency[];
  proposedAcceptanceCriteria: OperatorAcceptanceCriterion[];
  capabilityFit: OperatorCapabilityFit;
  /** What must be proven for the milestone to count as done. */
  verificationPlan: { claim: string; evidenceKind: CompletionEvidenceKind; description: string }[];
  /** True when the read could not ground enough to proceed: ask, don't act. */
  clarificationRequired: boolean;
  /** The questions to ask, when clarification is required. */
  clarifyingQuestions: string[];
  confidence: ConfidenceLevel;
  generatedAt: ISODateTime;
  reasonedByModel: boolean;
}

/** The verification plan every executable milestone must carry. */
export const MILESTONE_COMPLETION_KINDS: CompletionEvidenceKind[] = [
  "acceptance_criterion",
  "artifact",
  "changed_state",
  "downstream_receipt",
  "human_acceptance",
];
