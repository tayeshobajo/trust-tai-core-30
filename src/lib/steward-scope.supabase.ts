/**
 * STAGED — NOT WIRED TO ANY ROUTE. Concrete Supabase adapter for durable
 * meeting scope membership (required manual work, archived retention,
 * audited amendments, honest counts). Calls the proposed SQL functions via
 * RPC as the authenticated user (RLS applies). Unusable until the UNAPPLIED
 * patches in `docs/proposed/steward-backend/` are reviewed, applied, and
 * granted.
 *
 * RPC boundary (005_scope_membership.up.sql):
 * - steward_scope_add_item(p_org, p_conversation, p_task, p_classification, p_operation)
 * - steward_scope_amend_remove(p_org, p_conversation, p_item, p_reason, p_operation)
 * - steward_scope_counts(p_org, p_conversation) → {denominator, verified, pending_proposals}
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ScopeItem {
  id: string;
  organizationId: string;
  conversationId: string;
  taskId: string;
  classification: "transcript" | "manual_required";
  removedAt: string | null;
}

export interface ScopeCounts {
  denominator: number;
  verified: number;
  pendingProposals: number;
}

interface ScopeItemRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  task_id: string;
  classification: ScopeItem["classification"];
  removed_at: string | null;
}

function mapItem(row: ScopeItemRow): ScopeItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    taskId: row.task_id,
    classification: row.classification,
    removedAt: row.removed_at,
  };
}

function rethrow(error: { code?: string; message?: string } | null): never {
  /* Preserve the SQL errcode so the entrypoint can distinguish a KNOWN
     contract answer from an UNKNOWN transport/5xx failure (uncertain). */
  const failure = new Error(error?.message ?? "scope call failed");
  if (error?.code) (failure as { code?: string }).code = error.code;
  throw failure;
}

/** The client MUST be the authenticated per-request client (RLS as user). */
export function createSupabaseScopeRepository(supabase: SupabaseClient) {
  return {
    async addItem(input: {
      orgId: string;
      conversationId: string;
      taskId: string;
      classification: ScopeItem["classification"];
      operationId: string;
    }): Promise<ScopeItem> {
      const { data, error } = await supabase.rpc("steward_scope_add_item", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
        p_task: input.taskId,
        p_classification: input.classification,
        p_operation: input.operationId,
      });
      if (error) rethrow(error);
      return mapItem(data as ScopeItemRow);
    },
    async amendRemove(input: {
      orgId: string;
      conversationId: string;
      itemId: string;
      reason: string;
      operationId: string;
    }): Promise<ScopeItem> {
      const { data, error } = await supabase.rpc("steward_scope_amend_remove", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
        p_item: input.itemId,
        p_reason: input.reason,
        p_operation: input.operationId,
      });
      if (error) rethrow(error);
      return mapItem(data as ScopeItemRow);
    },
    /** Explicit audited reinstatement of a removed item — never silent. */
    async amendReinstate(input: {
      orgId: string;
      conversationId: string;
      itemId: string;
      reason: string;
      operationId: string;
    }): Promise<ScopeItem> {
      const { data, error } = await supabase.rpc("steward_scope_amend_reinstate", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
        p_item: input.itemId,
        p_reason: input.reason,
        p_operation: input.operationId,
      });
      if (error) rethrow(error);
      return mapItem(data as ScopeItemRow);
    },
    async counts(orgId: string, conversationId: string): Promise<ScopeCounts> {
      const { data, error } = await supabase.rpc("steward_scope_counts", {
        p_org: orgId,
        p_conversation: conversationId,
      });
      if (error) rethrow(error);
      const row = (Array.isArray(data) ? data[0] : data) as {
        denominator: number;
        verified: number;
        pending_proposals: number;
      };
      return {
        denominator: row.denominator,
        verified: row.verified,
        pendingProposals: row.pending_proposals,
      };
    },
    /** Explicit, audited, idempotent sync of recorded required-manual
        tasks into the meeting scope. Never creates or edits tasks; prior
        human decisions (linked/dismissed proposals, amendments) are
        preserved by the SQL. */
    async syncRequired(input: {
      orgId: string;
      conversationId: string;
      operationId: string;
    }): Promise<{ added: number }> {
      const { data, error } = await supabase.rpc("steward_scope_sync_required", {
        p_org: input.orgId,
        p_conversation: input.conversationId,
        p_operation: input.operationId,
      });
      if (error) rethrow(error);
      return { added: typeof data === "number" ? data : 0 };
    },
  };
}
