/**
 * STAGED — NOT WIRED TO ANY ROUTE. Concrete Supabase adapter for the
 * proposal ledger (registration + human dismissal). Calls the proposed
 * SQL functions via RPC as the authenticated user (RLS applies).
 * Unusable until the UNAPPLIED patches in `docs/proposed/steward-backend/`
 * are reviewed, applied, and granted.
 *
 * RPC boundary (004_proposal_links.up.sql):
 * - steward_register_proposals(p_org, p_conversation, p_operation, p_proposals, p_transcript)
 * - steward_dismiss_proposal(p_org, p_conversation, p_proposal, p_reason, p_operation)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerProposal, ProposalLedgerRepository } from "./steward-proposal-ledger.server";
import { TranscriptChangedError } from "./steward-proposal-ledger.server";

interface LedgerRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  source_key: string;
  kind: string;
  statement: string;
  status: LedgerProposal["status"];
  evidence?: unknown[];
}

function mapRow(row: LedgerRow): LedgerProposal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    sourceKey: row.source_key,
    evidence: (row.evidence as unknown[] | undefined) ?? [],
    kind: row.kind,
    statement: row.statement,
    status: row.status,
  };
}

function rethrow(error: { code?: string; message?: string } | null): never {
  if (error?.code === "P0001" || error?.message?.includes("transcript_changed")) {
    throw new TranscriptChangedError();
  }
  const err = new Error(error?.message ?? "proposal ledger call failed");
  if (error?.code) (err as { code?: string }).code = error.code;
  throw err;
}

/** The client MUST be the authenticated per-request client (RLS as user). */
export function createSupabaseProposalLedgerRepository(
  supabase: SupabaseClient,
): ProposalLedgerRepository {
  return {
    async registerProposals(input) {
      const { data, error } = await supabase.rpc("steward_register_proposals", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
        p_operation: input.operationId,
        p_proposals: input.proposals.map((p) => ({
          source_key: p.sourceKey,
          evidence: p.evidence ?? [],
          kind: p.kind,
          statement: p.statement,
        })),
        p_transcript: input.transcript,
      });
      if (error) rethrow(error);
      return data as number;
    },
    async dismissProposal(input) {
      const { data, error } = await supabase.rpc("steward_dismiss_proposal", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
        p_proposal: input.proposalId,
        p_reason: input.reason,
        p_operation: input.operationId,
      });
      if (error) rethrow(error);
      return mapRow(data as LedgerRow);
    },
    async ledgerForConversation(orgId, conversationId) {
      const { data, error } = await supabase
        .from("steward_proposal_ledger")
        .select(
          "id, organization_id, conversation_id, source_key, kind, statement, status, evidence",
        )
        .eq("organization_id", orgId)
        .eq("conversation_id", conversationId);
      if (error) rethrow(error);
      return ((data ?? []) as LedgerRow[]).map(mapRow);
    },
  };
}
