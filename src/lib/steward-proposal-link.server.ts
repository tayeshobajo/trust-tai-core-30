/**
 * STAGED — NOT WIRED TO ANY ROUTE. Explicit human proposal→existing-task
 * linking for Steward proposal review.
 *
 * Application-side half of the UNAPPLIED proposal in
 * `docs/proposed/steward-backend/004_proposal_links.up.sql`. A link is an
 * explicit human decision: it never creates a task or commitment, never
 * infers confirmed scope from notes, and invalidates coverage for the
 * conversation so scope review restarts honestly.
 */

export interface ProposalLink {
  id: string;
  organizationId: string;
  conversationId: string;
  proposalId: string;
  taskId: string;
  operationId: string;
  actorId: string;
  createdAt: string;
}

export class ProposalLinkConflictError extends Error {
  readonly code = "P0030";
  constructor(message = "this proposal is already linked to a task") {
    super(message);
    this.name = "ProposalLinkConflictError";
  }
}

/** Minimal repository contract over the proposed SQL functions. */
export interface ProposalLinkRepository {
  linkProposal(input: {
    orgId: string;
    conversationId: string;
    proposalId: string;
    taskId: string;
    operationId: string;
    actorId: string;
  }): Promise<{ link: ProposalLink; replayed: boolean }>;
  linksForConversation(orgId: string, conversationId: string): Promise<ProposalLink[]>;
}

export type LinkProposalResult =
  | { kind: "linked"; link: ProposalLink; replayed: boolean }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string }
  /* Transport ambiguity after send: the link may be durable. The caller
     keeps the pending operation for a same-id replay. */
  | { kind: "uncertain"; message: string };

/**
 * Record an explicit human decision linking a proposal to an EXISTING
 * canonical task. The same operation UUID replays the existing link
 * (idempotent retry); a different operation for an already-linked proposal
 * conflicts. The task must already exist in the org — linking never creates
 * a duplicate task or commitment.
 */

import { classifyMutationError } from "./steward-mutation-outcome";
export async function linkProposalToTask(
  repo: ProposalLinkRepository,
  input: {
    orgId: string;
    conversationId: string;
    proposalId: string;
    taskId: string;
    operationId: string;
    actorId: string;
  },
): Promise<LinkProposalResult> {
  try {
    const { link, replayed } = await repo.linkProposal(input);
    return { kind: "linked", link, replayed };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : "link failed";
    if (code === "P0030" || error instanceof ProposalLinkConflictError) {
      return { kind: "conflict", message };
    }
    /* Known contract answers are resolved; anything else (transport loss,
       5xx, malformed response after send) is UNCERTAIN — the link may
       have committed, so the same operation must be replayed. */
    return classifyMutationError(error);
  }
}
