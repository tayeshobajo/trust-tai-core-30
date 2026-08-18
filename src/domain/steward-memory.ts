/**
 * Trust Tai OS, Steward memory and learning contracts.
 *
 * Core law: Steward does not manage people. Steward helps people remember what
 * matters to one another.
 *
 * Memory here is small on purpose. It holds what helps Steward read the next
 * conversation kindly and accurately, who carries what, who hands off to
 * whom, who a piece of work is prepared for, and nothing that would turn a
 * colleague into a metric. There is no score, no ranking, no streak, and no
 * judgement of a person's character, motivation or reliability anywhere in
 * this file, and `MEMORY_FORBIDDEN_TERMS` exists so a test can keep it that
 * way.
 *
 * Everything is append only. A correction is a gift of context: it supersedes
 * an earlier belief and never erases it, so a person can always see what
 * Steward used to think and who taught it otherwise.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { TruthTier } from "./signals";

/* ------------------------------------------------------------ what memory is about */

/** The kind of thing a memory row is about. */
export type MemoryKind =
  /** Who a person is at work: title, pod, working context. */
  | "person"
  /** Something a person recurringly carries. */
  | "responsibility"
  /** A handoff or dependency between two people. */
  | "handoff"
  /** Context about a project a person works in. */
  | "project"
  /** A human correction of an earlier reading or belief. */
  | "correction";

/** Which part of an interpretation or belief a correction changed. */
export type MemoryFacet =
  | "meaning"
  | "owner"
  | "beneficiary"
  | "project"
  | "timing"
  | "responsibility"
  | "relationship"
  | "cadence"
  | "status"
  | "other";

export const MEMORY_FACET_LABEL: Record<MemoryFacet, string> = {
  meaning: "What it actually is",
  owner: "Who carries it",
  beneficiary: "Who it is for",
  project: "Which work it belongs to",
  timing: "When it matters",
  responsibility: "What someone recurringly carries",
  relationship: "How two people work together",
  cadence: "How often it happens",
  status: "Where the work stands",
  other: "Context",
};

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  person: "People",
  responsibility: "Responsibilities",
  handoff: "Working relationships",
  project: "Project context",
  correction: "Learned from you",
};

/**
 * The reasoning substrate, expressed as relationships rather than a graph
 * product. Nothing renders this as a diagram; it exists so interpretation can
 * ask "who hands off to whom" without inventing a new subsystem.
 */
export type MemoryRelation =
  | "carries"
  | "owns"
  | "depends_on"
  | "hands_off_to"
  | "prepares_for"
  | "belongs_to"
  | "changed";

/* ------------------------------------------------------------- outcomes */

/**
 * What a person did with something Steward offered.
 *
 * Outcomes are recorded, not scored. They exist so a person can see that their
 * feedback landed, and so Steward can stop raising a shape of reading people
 * keep telling it is only context. There is no weighting, no confidence maths
 * and no judgement of anyone, only a countable record of explicit decisions.
 */
export type LearningOutcome =
  | "confirmed"
  | "edited_then_confirmed"
  | "dismissed_as_context"
  | "marked_kept"
  | "marked_waiting"
  | "released"
  | "belief_confirmed"
  | "belief_corrected"
  | "belief_retired";

export const LEARNING_OUTCOME_LABEL: Record<LearningOutcome, string> = {
  confirmed: "Confirmed as read",
  edited_then_confirmed: "Corrected, then confirmed",
  dismissed_as_context: "Dismissed as context",
  marked_kept: "Marked as kept",
  marked_waiting: "Marked as waiting",
  released: "Released",
  belief_confirmed: "Confirmed as true",
  belief_corrected: "Put right by a person",
  belief_retired: "Retired",
};

/* --------------------------------------------------------------- the record */

/**
 * Structured memory carried alongside a belief.
 *
 * This rides inside the existing append-only belief ledger rather than a new
 * table, so history, provenance and RLS stay exactly where they already are.
 */
export interface MemoryMeta {
  kind: MemoryKind;
  facet: MemoryFacet;
  relation?: MemoryRelation;
  /** Normalized person the belief is about. */
  personKey?: string;
  personName?: string;
  /** The other person, for a handoff or dependency. */
  counterpartKey?: string;
  counterpartName?: string;
  projectLabel?: string;
  /** Stable identity of a repeating observation, so counting is honest. */
  patternKey?: string;
  /** Distinct canonical conversations this pattern was seen in. */
  sourceConversationIds?: string[];
  /** What Steward believed or read before the correction. */
  original?: string;
  /** What the person said instead. */
  corrected?: string;
  conversationId?: ID;
  commitmentId?: ID;
  /** The interpretation candidate a correction came from. */
  candidateId?: ID;
  /** What a person explicitly did, when this row records a decision. */
  outcome?: LearningOutcome;
  /** A person retired this belief. History stays; it stops being consulted. */
  retired?: boolean;
}


/** A belief with its structured memory decoded. */
export interface MemoryBelief {
  id: ID;
  organizationId: ID;
  subjectKey: string;
  subjectLabel: string;
  statement: string;
  tier: TruthTier;
  authority: "source" | "human";
  supersedesId?: ID;
  /** Evidence a person can read. The encoded payload is never in here. */
  evidence: EvidenceRef[];
  recordedBy: string;
  recordedAt: ISODateTime;
  meta: MemoryMeta;
}

/** What is written when Steward learns something. */
export interface MemoryDraft {
  subjectKey: string;
  subjectLabel: string;
  statement: string;
  tier: TruthTier;
  authority: "source" | "human";
  supersedesId?: ID;
  evidence: EvidenceRef[];
  meta: MemoryMeta;
}

/* -------------------------------------------------------- repeated evidence */

/**
 * How many distinct canonical conversations a pattern must appear in before
 * Steward will hold it as an inferred belief.
 *
 * Three, and they must be three different conversations. Two is a coincidence
 * and one is an event; three is the smallest number that reads as "this is how
 * the work actually flows" while still being wrong rarely enough that a person
 * correcting it does not feel nagged. Repetition inside a single meeting is
 * one observation, because a meeting talks about the same thing many times.
 */
export const RECURRING_PATTERN_THRESHOLD = 3;

/** One thing Steward saw happen, in one conversation. */
export interface MemoryObservation {
  patternKey: string;
  kind: MemoryKind;
  facet: MemoryFacet;
  relation: MemoryRelation;
  personKey: string;
  personName: string;
  counterpartKey?: string;
  counterpartName?: string;
  projectLabel?: string;
  /** The plain sentence this observation would become. */
  statement: string;
  conversationId: ID;
  conversationTitle: string;
  evidence: EvidenceRef[];
}

/* ------------------------------------------------------------- corrections */

/** A human correction, before it is written. */
export interface CorrectionDraft {
  facet: MemoryFacet;
  subjectKey: string;
  subjectLabel: string;
  /** What Steward had. */
  original: string;
  /** What the person said instead. */
  corrected: string;
  /** The sentence Steward will remember. */
  statement: string;
  conversationId?: ID;
  commitmentId?: ID;
  candidateId?: ID;
  personKey?: string;
  personName?: string;
  projectLabel?: string;
  evidence: EvidenceRef[];
}

/* --------------------------------------------------- continuity of one story */

/** How a later mention relates to work the workspace already carries. */
export type StateChangeKind = "already_completed" | "waiting" | "released" | "restated";

export const STATE_CHANGE_LABEL: Record<StateChangeKind, string> = {
  already_completed: "This appears to complete an existing commitment.",
  waiting: "This appears to move the commitment to waiting.",
  released: "This sounds like the commitment is no longer needed.",
  restated: "This looks like the same commitment, restated.",
};

/**
 * A suggestion, never an action. Steward proposes that a later mention belongs
 * to work already tracked; a person decides whether the state really changed.
 */
export interface StateChangeProposal {
  commitmentId: ID;
  commitmentStatement: string;
  currentStatus: string;
  /** Null for `restated`: the story is the same, the state did not move. */
  proposedStatus: "open" | "waiting" | "kept" | "released" | null;
  kind: StateChangeKind;
  /** The interpreted signal that triggered it. */
  signalId: ID;
  signalMeaning: string;
  because: string;
  evidence: EvidenceRef[];
}

/* ----------------------------------------------- memory offered to a reading */

/**
 * Memory conflicting with what the transcript plainly says. Never resolved
 * silently: both sides are carried so a person can read them next to each
 * other and say which one is actually true.
 */
export interface MemoryConflict {
  signalId: ID;
  facet: MemoryFacet;
  memorySays: string;
  transcriptSays: string;
  because: string;
  /** The belief in disagreement, so a correction can supersede it directly. */
  beliefId?: ID;
  beliefStatement?: string;
  subjectKey?: string;
  subjectLabel?: string;
  patternKey?: string;
  /** Who taught Steward the remembered side, and when. */
  memoryRecordedBy?: string;
  memoryRecordedAt?: ISODateTime;
  /** The sentence the transcript side would become if the reading is right. */
  transcriptStatement?: string;
}

/** One belief that was actually handed to an interpretation, and why. */
export interface MemoryUsage {
  beliefId: ID;
  subjectLabel: string;
  statement: string;
  tier: TruthTier;
  facet: MemoryFacet;
  /** Plain sentence: why this one was chosen out of everything Steward holds. */
  because: string;
}

/** The bounded slice of memory handed to one interpretation. */
export interface RelevantMemory {
  /** Human-decided statements. These outrank anything Steward worked out. */
  decided: string[];
  /** Patterns Steward inferred from repeated evidence, marked as such. */
  inferred: string[];
  people: { name: string; title?: string }[];
  projects: { id: ID; label: string }[];
  /** Exactly what was used, so a person can audit the reading. */
  used: MemoryUsage[];
  /** Beliefs held but deliberately left out, counted honestly. */
  consideredCount: number;
}

/** Hard ceilings, so a prompt never becomes a dossier dump. */
export const MEMORY_SELECTION_LIMITS = {
  decided: 8,
  inferred: 5,
  people: 8,
  projects: 5,
} as const;


/* --------------------------------------------------------------- the guard */

/**
 * Language that must never enter the memory model. Person-centred law, made
 * testable: Steward remembers what work flows through whom, never a verdict on
 * who someone is.
 */
export const MEMORY_FORBIDDEN_TERMS = [
  "score",
  "rating",
  "rank",
  "streak",
  "productivity",
  "performance",
  "reliability",
  "reliable",
  "unreliable",
  "motivation",
  "lazy",
  "diligent",
  "high performer",
  "low performer",
  "good communicator",
  "bad communicator",
  "attitude",
  "personality",
] as const;

/** True when a remembered sentence stays a fact about work, not a verdict. */
export function isPersonSafeStatement(statement: string): boolean {
  const value = statement.toLowerCase();
  return !MEMORY_FORBIDDEN_TERMS.some((term) => value.includes(term));
}

/** Stable identity for a repeating pattern. Same flow of work, same key. */
export function patternKeyOf(input: {
  relation: MemoryRelation;
  personKey: string;
  counterpartKey?: string | undefined;
  subject: string;
}): string {
  const subject = input.subject
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [input.relation, input.personKey, input.counterpartKey ?? "", subject]
    .filter((part) => part.length > 0)
    .join("|");
}
