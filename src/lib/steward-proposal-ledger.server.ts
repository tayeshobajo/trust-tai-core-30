/**
 * STAGED — NOT WIRED TO ANY ROUTE. Proposal ledger registration and
 * explicit human dismissal for Steward proposal review.
 *
 * Application-side half of the UNAPPLIED proposal in
 * `docs/proposed/steward-backend/004_proposal_links.up.sql`. Registration
 * maps the REAL extraction contract (`extractProposals` in
 * src/data/steward/extract.ts): each proposal's `id` IS its stable
 * source_key (provider:source:statementHash), the same key a confirmed
 * proposal carries into public.commitments.source_key. Registration is
 * idempotent re-extraction — it never resets a human's linked/dismissed
 * decision — and the SQL rejects registration against a transcript that
 * no longer matches what was extracted. Model suggestions are never
 * auto-confirmed: rows start 'proposed' and only an explicit human link
 * (004) or dismiss changes that.
 */

import { classifyMutationErrorNarrow } from "./steward-mutation-outcome";

export interface LedgerProposal {
  id: string;
  organizationId: string;
  conversationId: string;
  sourceKey: string;
  kind: string;
  statement: string;
  status: "proposed" | "linked" | "dismissed";
  /** Retained extractor evidence refs for human review. */
  evidence?: unknown[];
}

/** Extraction output shape consumed from src/data/steward/extract.ts. */
export interface ExtractedProposal {
  /** Stable source key — proposal.id from extractProposals. */
  id: string;
  kind: string;
  statement: string;
  /** Exact evidence refs from the extractor, retained for review. */
  evidence?: unknown[];
}

export class TranscriptChangedError extends Error {
  readonly code = "P0001";
  constructor(message = "the transcript changed since extraction; re-extract and review again") {
    super(message);
    this.name = "TranscriptChangedError";
  }
}

/** Minimal repository contract over the proposed SQL functions. */
export interface ProposalLedgerRepository {
  registerProposals(input: {
    orgId: string;
    conversationId: string;
    operationId: string;
    proposals: { sourceKey: string; kind: string; statement: string; evidence?: unknown[] }[];
    /** The exact transcript JSON the extraction ran over. */
    transcript: unknown;
    actorId: string;
  }): Promise<number>;
  dismissProposal(input: {
    orgId: string;
    conversationId: string;
    proposalId: string;
    reason: string;
    operationId: string;
    actorId: string;
  }): Promise<LedgerProposal>;
  ledgerForConversation(orgId: string, conversationId: string): Promise<LedgerProposal[]>;
}

/** Map extractProposals output to the registration payload. */
export function toRegistrationPayload(proposals: ExtractedProposal[]): {
  sourceKey: string;
  kind: string;
  statement: string;
  evidence?: unknown[];
}[] {
  return proposals.map((p) => ({
    sourceKey: p.id,
    kind: p.kind,
    statement: p.statement,
    ...(p.evidence !== undefined ? { evidence: p.evidence } : {}),
  }));
}

export type RegisterProposalsResult =
  | { kind: "registered"; added: number }
  | { kind: "transcript_changed"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "uncertain"; message: string };

/**
 * Register freshly extracted proposals. Idempotent: re-extraction of the
 * same transcript adds only new source keys and never duplicates or
 * resurrects decided rows.
 */
export async function registerExtractedProposals(
  repo: ProposalLedgerRepository,
  input: {
    orgId: string;
    conversationId: string;
    operationId: string;
    proposals: ExtractedProposal[];
    transcript: unknown;
    actorId: string;
  },
): Promise<RegisterProposalsResult> {
  try {
    const added = await repo.registerProposals({
      orgId: input.orgId,
      conversationId: input.conversationId,
      operationId: input.operationId,
      proposals: toRegistrationPayload(input.proposals),
      transcript: input.transcript,
      actorId: input.actorId,
    });
    return { kind: "registered", added };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : "registration failed";
    if (code === "P0001" || error instanceof TranscriptChangedError) {
      return { kind: "transcript_changed", message };
    }
    /* Transport/5xx/malformed failures after send are UNCERTAIN — the
       registration may be durable; the same operation must be replayed. */
    return classifyMutationErrorNarrow(error);
  }
}

export type DismissProposalResult =
  | { kind: "dismissed"; proposal: LedgerProposal }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "uncertain"; message: string };

/** Explicit human dismissal with a substantive reason. Never deletes. */
export async function dismissLedgerProposal(
  repo: ProposalLedgerRepository,
  input: {
    orgId: string;
    conversationId: string;
    proposalId: string;
    reason: string;
    operationId: string;
    actorId: string;
  },
): Promise<DismissProposalResult> {
  if (input.reason.trim().length < 10) {
    return { kind: "rejected", message: "dismissal reason must be at least 10 characters" };
  }
  try {
    const proposal = await repo.dismissProposal(input);
    return { kind: "dismissed", proposal };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : "dismissal failed";
    if (code === "P0030") return { kind: "conflict", message };
    return classifyMutationErrorNarrow(error);
  }
}
