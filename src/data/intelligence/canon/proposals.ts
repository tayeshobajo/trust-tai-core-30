/**
 * Governance for revision proposals.
 *
 * A proposal is repeated evidence asking for a reword. A person answers it
 * once: accept, reject, or defer. That answer is final for that exact
 * proposal, and it changes no pattern text. If later outcomes produce a
 * different suggestion, the wording changes, so the fingerprint changes, and
 * the question is asked again as a new one.
 */

import type { ID, ISODateTime } from "@/domain/entities";
import type {
  PatternRevisionDecision,
  PatternRevisionProposal,
  ProposalDecisionKind,
} from "@/domain/intelligence-canon";

/** Small stable hash, so a fingerprint stays short and readable in a ledger. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Content identity of a proposal: which pattern, at which version, saying
 * exactly what. New wording is a new question for a person.
 */
export function proposalFingerprint(proposal: PatternRevisionProposal): string {
  return `${proposal.patternId}@${proposal.fromVersion}#${hash(proposal.suggestion.trim())}`;
}

/** The decision already recorded for this proposal, when there is one. */
export function decisionFor(
  proposal: PatternRevisionProposal,
  decisions: PatternRevisionDecision[],
): PatternRevisionDecision | null {
  const fingerprint = proposalFingerprint(proposal);
  const matches = decisions
    .filter((row) => row.proposalFingerprint === fingerprint)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  return matches[0] ?? null;
}

/** Whether a person still owes this proposal an answer. */
export function awaitingDecision(
  proposal: PatternRevisionProposal,
  decisions: PatternRevisionDecision[],
): boolean {
  return decisionFor(proposal, decisions) === null;
}

export interface DecideProposalInput {
  organizationId: ID;
  proposal: PatternRevisionProposal;
  decision: ProposalDecisionKind;
  note?: string;
  decidedBy: ID;
  now: ISODateTime;
}

/** The row a proposal decision becomes. Never touches canon text. */
export function proposalDecisionRow(input: DecideProposalInput): PatternRevisionDecision {
  return {
    id: "",
    organizationId: input.organizationId,
    patternId: input.proposal.patternId,
    patternVersion: input.proposal.fromVersion,
    proposalFingerprint: proposalFingerprint(input.proposal),
    proposalText: input.proposal.suggestion,
    outcomeRefs: input.proposal.outcomeRefs,
    decision: input.decision,
    ...(input.note && input.note.trim().length > 0 ? { note: input.note.trim() } : {}),
    decidedBy: input.decidedBy,
    decidedAt: input.now,
  };
}
