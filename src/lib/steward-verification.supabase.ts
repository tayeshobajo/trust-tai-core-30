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
  /** The task revision the receipt was recorded against — verified credit
      exists only while this still equals the task's current revision. */
  task_revision_after: number;
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
    taskRevisionAfter: row.task_revision_after,
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
  /* Preserve the SQL errcode so the server layer can tell a KNOWN contract
     answer (authorization, not-found, operation conflict) from an UNKNOWN
     transport/5xx failure — the latter must surface as uncertain, never
     as a resolved rejection. */
  const failure = new Error(error?.message ?? "verification call failed");
  if (error?.code) (failure as { code?: string }).code = error.code;
  throw failure;
}

/** A response that arrived but does not match the contract is treated
    like a lost response: the durable outcome is unknown. */
function requireResult(data: unknown): RpcResult {
  const result = data as RpcResult | null;
  if (!result || typeof result !== "object" || !result.receipt || !result.receipt.id) {
    throw new Error("malformed verification response");
  }
  return result;
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
      const result = requireResult(data);
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
      const result = requireResult(data);
      const task = await readTask(input.orgId, input.taskId);
      return { task, replayed: result.replayed === true };
    },
  };
}

export interface MeetingVerificationProjectionRow {
  task_id: string;
  status: string;
  revision: number;
  latest_kind: string | null;
  latest_revision_after: number | null;
  verified: boolean;
  missing: string[];
}

/**
 * Read-only one-statement verification projection over the caller's RLS
 * session. Backs getMeetingVerificationProjectionFn; the RPC is the
 * UNAPPLIED 007 patch, granted only in grants.review.sql.
 */
export async function readMeetingVerificationProjection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed RPC is not in generated types until the UNAPPLIED patch lands
  supabase: any,
  orgId: string,
  taskIds: string[],
): Promise<{ rows: MeetingVerificationProjectionRow[] | null; error: unknown }> {
  const { data, error } = await supabase.rpc("steward_meeting_verification_projection", {
    p_org: orgId,
    p_task_ids: taskIds,
  });
  return { rows: (data as MeetingVerificationProjectionRow[] | null) ?? null, error };
}

/**
 * Fold projection rows into per-task truth for the REQUESTED ids. Any
 * requested id without a returned row — including the zero-visible-rows
 * case, where the RPC returns no row to carry `missing` — is UNKNOWN,
 * never false. Only rows with an explicit boolean count as known.
 */
export function foldVerificationProjection(
  requestedIds: string[],
  rows: MeetingVerificationProjectionRow[],
): { verified: Record<string, boolean>; byTask: Record<string, MeetingVerificationProjectionRow>; unknown: string[] } {
  const requested = new Set(requestedIds);
  const verified: Record<string, boolean> = {};
  const byTask: Record<string, MeetingVerificationProjectionRow> = {};
  for (const row of rows) {
    if (!requested.has(row.task_id)) continue;
    if (row.verified !== true && row.verified !== false) continue;
    verified[row.task_id] = row.verified;
    byTask[row.task_id] = row;
  }
  const unknown = requestedIds.filter((id) => !(id in verified));
  return { verified, byTask, unknown: Array.from(new Set(unknown)) };
}

export const TASK_HISTORY_LIMIT = 100;

/**
 * Bounded, display-only receipt history for ONE task: newest first
 * (created_at DESC, id DESC), LIMIT 101 so truncation is detected, trimmed
 * to 100 and reversed to chronological order. NEVER used to derive the
 * verified state — that comes only from the projection RPC.
 */
export async function readTaskVerificationHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed table is not in generated types until the UNAPPLIED patch lands
  supabase: any,
  orgId: string,
  taskId: string,
): Promise<{ receipts: TaskReceipt[]; truncated: boolean; error: unknown }> {
  const { data, error } = await supabase
    .from("steward_task_receipts")
    .select(
      "id, organization_id, task_id, operation_id, kind, note, actor_id, created_at, task_revision_after",
    )
    .eq("organization_id", orgId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TASK_HISTORY_LIMIT + 1);
  if (error) return { receipts: [], truncated: false, error };
  const rows = (data as ReceiptRow[] | null) ?? [];
  const truncated = rows.length > TASK_HISTORY_LIMIT;
  const receipts = rows
    .slice(0, TASK_HISTORY_LIMIT)
    .reverse()
    .map((row) =>
      mapReceipt({
        ...row,
        kind: row.kind === "reopen" ? "reopen" : "verify",
        task_revision_after: typeof row.task_revision_after === "number" ? row.task_revision_after : -1,
      }),
    );
  return { receipts, truncated, error: null };
}
