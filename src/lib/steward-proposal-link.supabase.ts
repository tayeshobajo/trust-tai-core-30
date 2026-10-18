/**
 * STAGED — NOT WIRED TO ANY ROUTE. Concrete Supabase adapter for explicit
 * human proposal→existing-task linking. Calls the proposed SQL function via
 * RPC as the authenticated user (RLS applies). Unusable until the UNAPPLIED
 * patches in `docs/proposed/steward-backend/` are reviewed, applied, and
 * granted.
 *
 * RPC boundary (004_proposal_links.up.sql):
 * - steward_link_proposal(p_org, p_conversation, p_proposal, p_task, p_operation)
 *   p_proposal is a steward_proposal_ledger id — the additive canonical
 *   ledger keyed by conversation + source key, not an invented base table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposalLink, ProposalLinkRepository } from "./steward-proposal-link.server";
import { ProposalLinkConflictError } from "./steward-proposal-link.server";

interface LinkRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  proposal_id: string;
  task_id: string;
  operation_id: string;
  actor_id: string;
  created_at: string;
}

function mapLink(row: LinkRow): ProposalLink {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    proposalId: row.proposal_id,
    taskId: row.task_id,
    operationId: row.operation_id,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

function rethrow(error: { code?: string; message?: string } | null): never {
  if (error?.code === "P0030" || error?.message?.includes("proposal_already_linked")) {
    throw new ProposalLinkConflictError();
  }
  /* Preserve the SQL errcode so the server layer can distinguish a KNOWN
     contract answer from an UNKNOWN transport/5xx failure (uncertain). */
  const failure = new Error(error?.message ?? "proposal link call failed");
  if (error?.code) (failure as { code?: string }).code = error.code;
  throw failure;
}

/** The client MUST be the authenticated per-request client (RLS as user). */
export function createSupabaseProposalLinkRepository(
  supabase: SupabaseClient,
): ProposalLinkRepository {
  return {
    async linkProposal(input) {
      const { data, error } = await supabase.rpc("steward_link_proposal", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
        p_proposal: input.proposalId,
        p_task: input.taskId,
        p_operation: input.operationId,
      });
      if (error) rethrow(error);
      const link = mapLink(data as LinkRow);
      return {
        link,
        replayed: link.operationId === input.operationId && link.taskId !== input.taskId,
      };
    },
    async linksForConversation(orgId, conversationId) {
      const { data, error } = await supabase
        .from("steward_proposal_links")
        .select("*")
        .eq("organization_id", orgId)
        .eq("conversation_id", conversationId);
      if (error) rethrow(error);
      return ((data ?? []) as LinkRow[]).map(mapLink);
    },
  };
}
