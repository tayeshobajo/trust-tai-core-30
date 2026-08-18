/**
 * Trust Tai OS, Steward semantic interpretation contracts.
 *
 * Deterministic extraction is a scout. It finds passages that might carry
 * work. It does not decide what happened. Interpretation is where a bounded
 * piece of a real conversation is read for meaning, in plain language, with
 * the honest option of saying "this is only context" or "I cannot tell".
 *
 * Laws encoded here:
 *  - nothing produced before a person confirms may be `decided`
 *  - a due date is never manufactured; only spoken timing survives, as words
 *  - a passage Steward cannot state clearly never reaches a person's Today
 *  - the raw transcript stays evidence, never the user-facing meaning
 */

import type { ConfidenceLevel, EvidenceRef } from "./confidence";
import type { ID } from "./entities";
import type { TranscriptSegment } from "./steward";

/* --------------------------------------------------------- candidate scout */

/**
 * A passage worth interpreting, with enough of the surrounding conversation to
 * resolve a pronoun or a reference without reading the whole call.
 */
export interface CandidatePassage {
  /** Stable across re-reads of the same conversation. */
  id: ID;
  speaker: string;
  speakerEmail?: string;
  at: string;
  /** The focus text the scout flagged. */
  text: string;
  /** Turns before and after, in order, including the focus turn. */
  context: { speaker: string; at: string; text: string }[];
  segments: TranscriptSegment[];
  /** Why the deterministic scout stopped here. Never shown as meaning. */
  cue: "promise" | "request" | "decision" | "dependency" | "question" | "provider_action";
  /** Provider-extracted action item text, when this candidate came from one. */
  providerActionItem?: string;
  evidence: EvidenceRef[];
}

/* ------------------------------------------------------------ disposition */

export type SemanticDisposition =
  | "commitment"
  | "decision"
  | "dependency"
  | "unresolved_question"
  | "context_only"
  | "duplicate"
  | "already_completed"
  | "insufficient_evidence";

export const DISPOSITION_LABEL: Record<SemanticDisposition, string> = {
  commitment: "Commitment",
  decision: "Decision",
  dependency: "Dependency",
  unresolved_question: "Open question",
  context_only: "Context",
  duplicate: "Already tracked",
  already_completed: "Already done",
  insufficient_evidence: "Not clear enough",
};

/** Only these ever reach a person's review surface. */
export const REVIEWABLE_DISPOSITIONS: SemanticDisposition[] = [
  "commitment",
  "decision",
  "dependency",
  "unresolved_question",
];

/**
 * One interpreted signal. `normalizedMeaning` is the sentence a person reads;
 * the transcript lives in `evidence` and `quote`, behind disclosure.
 */
export interface InterpretedSignal {
  /** Same id as the candidate it came from. */
  id: ID;
  candidateId: ID;
  disposition: SemanticDisposition;
  /** One concise operational sentence, in plain English. */
  normalizedMeaning: string;
  ownerName: string | null;
  ownerConfidence: ConfidenceLevel;
  beneficiary: string | null;
  /** Verbatim words about timing. Never converted into a date. */
  dueText: string | null;
  /** Always null before a person sets one. */
  dueAt: null;
  projectId: ID | null;
  projectLabel: string | null;
  confidence: ConfidenceLevel;
  /** Pre-confirmation truth is observed or inferred. Never decided. */
  truthTier: "observed" | "inferred";
  /** Why Steward read it this way, in one short sentence. */
  rationale: string;
  /** What is being waited on, and who is being waited on. */
  dependencyOn: string | null;
  blockedBy: string | null;
  /** Existing canonical commitment this repeats, when memory could be read. */
  duplicateOfId: ID | null;
  /** What stays unclear. Empty string when nothing does. */
  ambiguity: string;
  /** The transcript line, kept as evidence only. */
  quote: string;
  at: string;
  evidence: EvidenceRef[];
}

/** Honest state of the memory used during interpretation. */
export interface MemoryContext {
  available: boolean;
  /** Plain sentence a person can read when memory could not be consulted. */
  because: string;
  openCommitments: { id: ID; statement: string; ownerName: string; status: string }[];
  people: { name: string; email?: string; title?: string }[];
  projects: { id: ID; label: string }[];
  /** What a person has decided. Outranks anything Steward worked out. */
  decided?: string[];
  /** What Steward inferred from repeated evidence. Context, never authority. */
  inferred?: string[];
}


export interface InterpretationRun {
  conversationTitle: string;
  occurredAt: string;
  candidateCount: number;
  signals: InterpretedSignal[];
  memory: { available: boolean; because: string };
  provider: string;
  model: string;
  generatedAt: string;
}

/** Counts by disposition, for acceptance reporting and diagnostics. */
export function dispositionCounts(
  signals: InterpretedSignal[],
): Record<SemanticDisposition, number> {
  const counts: Record<SemanticDisposition, number> = {
    commitment: 0,
    decision: 0,
    dependency: 0,
    unresolved_question: 0,
    context_only: 0,
    duplicate: 0,
    already_completed: 0,
    insufficient_evidence: 0,
  };
  for (const signal of signals) counts[signal.disposition] += 1;
  return counts;
}
