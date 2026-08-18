/**
 * Interpretation, validated.
 *
 * Pure functions over model output. The model proposes meaning; these rules
 * constrain it. Anything the laws do not allow is demoted rather than
 * corrected silently, and a passage Steward cannot state clearly is withheld
 * from people instead of dressed up as a promise.
 */

import { z } from "zod";

import type { ConfidenceLevel } from "@/domain/confidence";
import type { Commitment } from "@/domain/steward";
import {
  REVIEWABLE_DISPOSITIONS,
  type CandidatePassage,
  type InterpretedSignal,
  type SemanticDisposition,
} from "@/domain/steward-semantic";

/* ------------------------------------------------------------- validation */

const DISPOSITIONS = [
  "commitment",
  "decision",
  "dependency",
  "unresolved_question",
  "context_only",
  "duplicate",
  "already_completed",
  "insufficient_evidence",
] as const;

const CONFIDENCE = ["high", "moderate", "low", "unknown"] as const;

const nullableString = z.union([z.string(), z.null()]).optional();

export const interpretationSchema = z.object({
  candidate_id: z.string(),
  disposition: z.enum(DISPOSITIONS),
  normalized_meaning: z.string(),
  owner: nullableString,
  owner_confidence: z.enum(CONFIDENCE).optional(),
  beneficiary: nullableString,
  due_text: nullableString,
  project_label: nullableString,
  confidence: z.enum(CONFIDENCE).optional(),
  truth_tier: z.enum(["observed", "inferred"]).optional(),
  rationale: z.string().optional(),
  dependency_on: nullableString,
  blocked_by: nullableString,
  duplicate_of: nullableString,
  ambiguity: nullableString,
});

export const interpretationBatchSchema = z.object({
  interpretations: z.array(interpretationSchema),
});

export type RawInterpretation = z.infer<typeof interpretationSchema>;

/* -------------------------------------------------------- meaning quality */

/** ASR wreckage and filler that must never be read as an operational sentence. */
const TRANSCRIPT_NOISE =
  /(you know\b|i mean\b|kind of\b|sort of\b|\bum\b|\buh\b|if you recall|as i (said|was saying)|like i said)/i;

const SENTENCE_OPENER_JUNK = /^(and|so|but|because|which|that|then|also|well|okay|yeah|right)\b/i;

const ACTION_WORD =
  /\b(send|share|email|forward|write|draft|prepare|populate|document|schedule|book|set up|create|build|add|update|review|check|confirm|follow up|present|deliver|fix|call|reach out|put together|log|submit|sign|pay|hire|plan|define|map|record|publish|test|deploy|arrange|invite|assign|finalise|finalize|chase|escalate|onboard|hand over|raise|decide|agree|wait|approve|answer|clarify)\b/i;

/**
 * Is this a sentence a person can act on without reading the transcript?
 * Short, clean, verb-led, free of speech debris.
 */
export function isCleanMeaning(text: string): boolean {
  const value = text.trim();
  if (value.length < 8 || value.length > 160) return false;
  if (SENTENCE_OPENER_JUNK.test(value)) return false;
  if (TRANSCRIPT_NOISE.test(value)) return false;
  if (/\.{3}|…/.test(value)) return false;
  /* Repeated capitalised fragments are the fingerprint of broken ASR. */
  if (/\b(\w+)\s+\1\b/i.test(value)) return false;
  return ACTION_WORD.test(value);
}

/* ------------------------------------------------------------ duplicates */

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlap(a: string, b: string): number {
  const left = new Set(normalizeForMatch(a).split(" ").filter((word) => word.length > 3));
  const right = new Set(normalizeForMatch(b).split(" ").filter((word) => word.length > 3));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** An existing canonical commitment this meaning repeats, if any. */
export function findDuplicate(
  meaning: string,
  commitments: Commitment[],
): Commitment | null {
  let best: { commitment: Commitment; score: number } | null = null;
  for (const commitment of commitments) {
    if (commitment.status === "released") continue;
    const score = overlap(meaning, commitment.what);
    if (score >= 0.7 && (!best || score > best.score)) best = { commitment, score };
  }
  return best?.commitment ?? null;
}

/* -------------------------------------------------------------- assembly */

function confidenceOf(value: string | undefined): ConfidenceLevel {
  return (CONFIDENCE as readonly string[]).includes(value ?? "")
    ? (value as ConfidenceLevel)
    : "unknown";
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Turn one validated model reading into a signal, applying the laws:
 * never decided, never an invented date, and never a meaning a person cannot
 * read on its own.
 */
export function toSignal(
  raw: RawInterpretation,
  candidate: CandidatePassage,
  commitments: Commitment[],
): InterpretedSignal {
  const meaning = (raw.normalized_meaning ?? "").replace(/\s+/g, " ").trim();
  let disposition: SemanticDisposition = raw.disposition;
  let ambiguity = clean(raw.ambiguity) ?? "";

  /* A promise Steward cannot state clearly is not a promise a person should carry. */
  if (
    (REVIEWABLE_DISPOSITIONS as string[]).includes(disposition) &&
    disposition !== "unresolved_question" &&
    !isCleanMeaning(meaning)
  ) {
    disposition = "insufficient_evidence";
    ambiguity =
      ambiguity ||
      "Steward could not state this as one clear operational sentence, so it is held back.";
  }

  const duplicate =
    disposition === "commitment" ? findDuplicate(meaning, commitments) : null;
  if (duplicate) disposition = "duplicate";

  return {
    id: candidate.id,
    candidateId: candidate.id,
    disposition,
    normalizedMeaning: meaning,
    ownerName: clean(raw.owner),
    ownerConfidence: confidenceOf(raw.owner_confidence),
    beneficiary: clean(raw.beneficiary),
    dueText: clean(raw.due_text),
    /* A date is only ever set by a person, later. */
    dueAt: null,
    projectId: null,
    projectLabel: clean(raw.project_label),
    confidence: confidenceOf(raw.confidence),
    /* Pre-confirmation truth is never decided. */
    truthTier: raw.truth_tier === "observed" ? "observed" : "inferred",
    rationale: clean(raw.rationale) ?? "Steward did not explain this reading.",
    dependencyOn: clean(raw.dependency_on),
    blockedBy: clean(raw.blocked_by),
    duplicateOfId: duplicate?.id ?? clean(raw.duplicate_of),
    ambiguity,
    quote: candidate.text,
    at: candidate.at,
    evidence: candidate.evidence,
  };
}

/** What a person is actually asked to review. Context and doubt stay out. */
export function reviewableSignals(signals: InterpretedSignal[]): InterpretedSignal[] {
  return signals.filter((signal) =>
    (REVIEWABLE_DISPOSITIONS as string[]).includes(signal.disposition),
  );
}

/** Everything withheld from review, kept for diagnostics and acceptance. */
export function withheldSignals(signals: InterpretedSignal[]): InterpretedSignal[] {
  return signals.filter(
    (signal) => !(REVIEWABLE_DISPOSITIONS as string[]).includes(signal.disposition),
  );
}

/* --------------------------------------------------------- confirmation */

const KIND_OF: Record<string, "action" | "decision" | "blocker" | "question"> = {
  commitment: "action",
  decision: "decision",
  dependency: "blocker",
  unresolved_question: "question",
};

/**
 * The shape a person confirms.
 *
 * The statement written into the workspace is the normalized meaning, never
 * the raw speech, the transcript stays behind it as evidence. The id is the
 * candidate's stable key, so confirming the same passage twice cannot create
 * the promise twice.
 */
export function signalToProposal(signal: InterpretedSignal): import("@/domain/steward").Proposal {
  return {
    id: signal.candidateId,
    kind: KIND_OF[signal.disposition] ?? "action",
    statement: signal.normalizedMeaning,
    tier: signal.truthTier,
    confidence: signal.confidence,
    ownerName: signal.ownerName,
    ownerResolved: Boolean(signal.ownerName) && signal.ownerConfidence === "high",
    dueText: signal.dueText,
    dueResolved: false,
    beneficiary: signal.beneficiary,
    quote: signal.quote,
    at: signal.at,
    segmentIndex: 0,
    evidence: signal.evidence,
    status: "proposed",
  };
}
