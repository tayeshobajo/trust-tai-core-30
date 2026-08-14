/**
 * Trust Tai OS — Steward contracts.
 *
 * "Steward turns meetings, conversations, and commitments into clear next
 * moves, then helps every person follow through."
 *
 * Steward owns no company, project or person of its own. It reads a
 * conversation, proposes what it thinks happened, and a human decides. Three
 * tiers of truth are kept apart at all times:
 *
 *   observed — the words are in the transcript
 *   inferred — Steward worked it out, and says so
 *   decided  — a person confirmed it
 *
 * Nothing here invents an owner, a date, a commitment or a project link.
 */

import type { ConfidenceLevel, EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { TruthTier } from "./signals";

/* ------------------------------------------------------------- ingestion */

/** Sources Steward may one day read. Only `fathom` and `fixture` exist in v1. */
export type ConversationProvider =
  | "fathom"
  | "manual"
  | "gmail"
  | "plaud"
  | "slack"
  | "teams"
  | "calendar"
  /** The labelled rehearsal transcript. Never production truth. */
  | "fixture";

/** A stable, safe pointer at a conversation living in another system. */
export interface ConversationSourceRef {
  provider: ConversationProvider;
  /** Provider-side record id when known (Fathom recording id). */
  externalId?: string;
  /** Share token parsed from a pasted link, when that is all we have. */
  shareToken?: string;
  /** The exact URL a person pasted, preserved verbatim. */
  url: string;
}

export interface ConversationParticipant {
  name: string;
  email?: string;
  emailDomain?: string;
}

export interface TranscriptSegment {
  index: number;
  speaker: string;
  speakerEmail?: string;
  /** Offset from the start of the recording, `HH:MM:SS`. */
  at: string;
  text: string;
  /** Deep link back to this moment when the provider gives one. */
  url?: string;
}

/** What every source adapter must return. Steward reads nothing else. */
export interface NormalizedConversation {
  sourceRef: ConversationSourceRef;
  title: string;
  occurredAt: ISODateTime;
  participants: ConversationParticipant[];
  segments: TranscriptSegment[];
  /** The provider's own summary, kept as source material, never as truth. */
  sourceSummary?: string;
  /** Action items the provider itself extracted, if any. */
  sourceActionItems: {
    description: string;
    assigneeName?: string;
    assigneeEmail?: string;
    at?: string;
    url?: string;
  }[];
  /** True when this came from the rehearsal fixture. */
  rehearsal?: boolean;
}

/** Honest state of a source adapter, safe to show a person. Never a key. */
export interface SourceAdapterStatus {
  provider: ConversationProvider;
  configured: boolean;
  /** One plain sentence describing what a person can do right now. */
  because: string;
}

export interface ConversationSourceAdapter {
  provider: ConversationProvider;
  status(): SourceAdapterStatus;
  parse(input: string): ConversationSourceRef | null;
  fetchConversation(ref: ConversationSourceRef): Promise<NormalizedConversation>;
}

/* ------------------------------------------------------------- proposals */

export type ProposalKind = "action" | "decision" | "follow_up" | "blocker" | "question";

export const PROPOSAL_KIND_LABEL: Record<ProposalKind, string> = {
  action: "Actions",
  decision: "Decisions",
  follow_up: "Follow ups",
  blocker: "Blockers",
  question: "Needs clarification",
};

export type ProposalStatus = "proposed" | "confirmed" | "dismissed";

/**
 * One thing Steward believes came out of a conversation. It always carries the
 * line it rests on. An owner or a date that was not actually said stays
 * unresolved — it is never guessed.
 */
export interface Proposal {
  /** Stable across re-analysis of the same conversation. */
  id: ID;
  kind: ProposalKind;
  statement: string;
  tier: TruthTier;
  confidence: ConfidenceLevel;
  /** Name as spoken. Null when the transcript did not say who. */
  ownerName: string | null;
  ownerResolved: boolean;
  /** The words used about timing, e.g. "by Friday". Never converted to a date. */
  dueText: string | null;
  dueResolved: boolean;
  beneficiary: string | null;
  /** The transcript line, verbatim. */
  quote: string;
  at: string;
  segmentIndex: number;
  evidence: EvidenceRef[];
  status: ProposalStatus;
}

/* ----------------------------------------------------------- commitments */

export type CommitmentStatus = "open" | "waiting" | "kept" | "released";

export const COMMITMENT_STATUS_LABEL: Record<CommitmentStatus, string> = {
  open: "Open",
  waiting: "Waiting",
  kept: "Kept",
  released: "Released",
};

/**
 * A commitment is a promise a person made. It is not a task: a task is how the
 * promise gets done, and may live in Projects.
 */
export interface Commitment {
  id: ID;
  organizationId: ID;
  conversationId: ID;
  /** Who promised. Name is what was said; ids are only ever human-linked. */
  ownerName: string;
  ownerEmail?: string;
  ownerUserId?: ID;
  what: string;
  /** To whom, when the conversation actually said so. */
  beneficiary?: string;
  /** Only ever set by a person. Extraction never writes this. */
  dueAt?: ISODateTime;
  /** What was said about timing, verbatim. */
  dueText?: string;
  status: CommitmentStatus;
  /** Canonical work this promise belongs to, when a person linked it. */
  projectId?: ID;
  decisionId?: ID;
  /** Stable key: the same promise from the same line never duplicates. */
  sourceKey: string;
  evidence: EvidenceRef[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ---------------------------------------------------------- role memory */

/** Context for recommendations. Never a score, never a ranking. */
export interface RoleMemory {
  id?: ID;
  organizationId: ID;
  /** Lowercased email when known, otherwise a normalized name. */
  personKey: string;
  userId?: ID;
  name: string;
  title?: string;
  pod?: string;
  responsibilities: string[];
  cadence: string[];
  projectIds: ID[];
  notes: string[];
  updatedAt: ISODateTime;
}

export type PersonStanding = "on_track" | "needs_attention" | "waiting";

export const PERSON_STANDING_LABEL: Record<PersonStanding, string> = {
  on_track: "On track",
  needs_attention: "Needs attention",
  waiting: "Waiting",
};

/* ---------------------------------------------------------------- memory */

/** Where a belief's authority comes from. Human always outranks source. */
export type BeliefAuthority = "source" | "human";

export interface Belief {
  id: ID;
  organizationId: ID;
  /** What the belief is about: a person key, a project id, a conversation id. */
  subjectKey: string;
  subjectLabel: string;
  statement: string;
  tier: TruthTier;
  authority: BeliefAuthority;
  /** The belief this correction replaces. The original is never deleted. */
  supersedesId?: ID;
  evidence: EvidenceRef[];
  recordedBy: string;
  recordedAt: ISODateTime;
}

/* ----------------------------------------------------------------- today */

export type MoveState = "at_risk" | "needs_movement" | "waiting";

export const MOVE_STATE_LABEL: Record<MoveState, string> = {
  at_risk: "At risk",
  needs_movement: "Needs movement",
  waiting: "Waiting",
};

/** One line on the Today list. Ordered deterministically, never by prose. */
export interface TodayMove {
  id: ID;
  /** The action, in a person's own words where possible. */
  title: string;
  /** Why it is here, in one sentence, from real state. */
  why: string;
  ownerName: string;
  state: MoveState;
  tier: TruthTier;
  sourceLabel: string;
  evidence: EvidenceRef[];
  destination: { appId: string; label: string; route: string };
  /** Sort weight. Derived, never typed in. */
  urgency: number;
  /**
   * True when the confirmed statement still reads as raw speech rather than a
   * clear operational sentence. Steward shows it, says so, and asks a person
   * to restate it rather than pretending it is actionable.
   */
  needsCorrection?: boolean;
  at: ISODateTime;
}

/** The normalized key used to identify a person without inventing an account. */
export function personKeyOf(input: { email?: string | null; name?: string | null }): string {
  const email = (input.email ?? "").trim().toLowerCase();
  if (email) return email;
  return (input.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
