/**
 * STAGED — NOT WIRED TO ANY ROUTE. Concrete Supabase adapter for atomic
 * evidence-backed verification/reopen. Calls the proposed SQL functions via
 * RPC as the authenticated user (RLS applies). Unusable until the UNAPPLIED
 * patches in `docs/proposed/steward-backend/` are reviewed, applied, and
 * granted.
 *
 * RPC boundary (002_atomic_verification.up.sql):
 * - steward_verify_task(p_org, p_task, p_expected_revision, p_operation, p_note)
 * - steward_reopen_task(p_org, p_task, p_expected_revision, p_operation, p_reason)
 * Both return jsonb {receipt, replayed}: the explicit replayed flag is the
 * only reliable replay signal. The task state is re-read through RLS
 * afterwards; a reread failure does NOT undo the committed transaction —
 * the durable receipt is returned with task: null so the caller can
 * reconcile instead of retrying blindly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TaskReceipt,
  VerificationRepository,
  VerificationTaskState,
} from "./steward-verification.server";
import { EvidenceRequiredError, RevisionConflictError } from "./steward-verification.server";

interface ReceiptRow {
  id: string;
  organization_id: string;
  task_id: string;
  operation_id: string;
  kind: "verify" | "reopen";
  note: string;
  actor_id: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  status: "open" | "complete";
  revision: number;
  completion_evidence: string | null;
  completed_at: string | null;
  completed_by: string | null;
}

function mapReceipt(row: ReceiptRow): TaskReceipt {
  return {
    id: row.id,
    organizationId: row.organization_id,
    taskId: row.task_id,
    operationId: row.operation_id,
    kind: row.kind,
    note: row.note,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

function mapTask(row: TaskRow): VerificationTaskState {
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    completionEvidence: row.completion_evidence,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
  };
}

interface RpcResult {
  receipt: ReceiptRow;
  replayed: boolean;
}

function rethrow(error: { code?: string; message?: string } | null): never {
  if (error?.code === "P0001" || error?.message?.includes("revision_conflict")) {
    throw new RevisionConflictError();
  }
  if (error?.code === "P0010" || error?.message?.includes("evidence_required")) {
    throw new EvidenceRequiredError();
  }
  throw new Error(error?.message ?? "verification call failed");
}

/** The client MUST be the authenticated per-request client (RLS as user). */
export function createSupabaseVerificationRepository(
  supabase: SupabaseClient,
): VerificationRepository {
  // Post-commit reread. A failure here does NOT mean the transaction
  // failed — the receipt is already durable. Return null so the caller
  // reconciles from the receipt instead of retrying a committed operation.
  async function readTask(orgId: string, taskId: string): Promise<VerificationTaskState | null> {
    const { data, error } = await supabase
      .from("steward_tasks")
      .select("id, status, revision, completion_evidence, completed_at, completed_by")
      .eq("id", taskId)
      .eq("organization_id", orgId)
      .single();
    if (error) return null;
    return mapTask(data as TaskRow);
  }

  return {
    async verifyTask(input) {
      const { data, error } = await supabase.rpc("steward_verify_task", {
        p_org: input.orgId,
        p_task: input.taskId,
        p_expected_revision: input.expectedRevision,
        p_operation: input.operationId,
        p_note: input.note,
      });
      if (error) rethrow(error);
      const result = data as RpcResult;
      const receipt = mapReceipt(result.receipt);
      const task = await readTask(input.orgId, input.taskId);
      return { task, receipt, replayed: result.replayed === true };
    },
    async reopenTask(input) {
      const { data, error } = await supabase.rpc("steward_reopen_task", {
        p_org: input.orgId,
        p_task: input.taskId,
        p_expected_revision: input.expectedRevision,
        p_operation: input.operationId,
        p_reason: input.reason,
      });
      if (error) rethrow(error);
      const result = data as RpcResult;
      const task = await readTask(input.orgId, input.taskId);
      return { task, replayed: result.replayed === true };
    },
  };
}
