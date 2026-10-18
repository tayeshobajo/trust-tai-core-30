/**
 * STAGED — NOT WIRED TO ANY ROUTE. Concrete Supabase adapter for the
 * canonical Steward preparation runner. Every call goes through the
 * proposed SQL functions via RPC as the authenticated user (RLS applies);
 * the adapter holds no authority of its own and never uses the admin
 * client. Unusable until the UNAPPLIED patches in
 * `docs/proposed/steward-backend/` are reviewed, applied, and granted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CanonicalRun,
  CanonicalRunInputRef,
  CanonicalRunRepository,
} from "./steward-canonical-run.server";
import { OperationConflictError } from "./steward-canonical-run.server";

interface RunRow {
  id: string;
  organization_id: string;
  task_id: string;
  action: CanonicalRun["action"];
  client_operation_id: string;
  request_digest: string;
  input_snapshot: CanonicalRun["inputSnapshot"];
  status: CanonicalRun["status"];
  artifact_text: string | null;
  artifact_digest: string | null;
  evidence_refs: string[];
  requested_by: string;
  attempts: number;
  max_attempts: number;
  failure_reason: string | null;
  claim_token: string | null;
  claim_version: number;
}

function mapRun(row: RunRow): CanonicalRun {
  return {
    id: row.id,
    organizationId: row.organization_id,
    taskId: row.task_id,
    action: row.action,
    clientOperationId: row.client_operation_id,
    requestDigest: row.request_digest,
    inputSnapshot: row.input_snapshot,
    status: row.status,
    artifactText: row.artifact_text,
    artifactDigest: row.artifact_digest,
    evidenceRefs: row.evidence_refs,
    requestedBy: row.requested_by,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    failureReason: row.failure_reason,
    claimToken: row.claim_token,
    claimVersion: row.claim_version,
  };
}

function rethrow(error: { code?: string; message?: string } | null): never {
  if (error?.code === "P0002" || error?.message?.includes("operation_conflict")) {
    throw new OperationConflictError("operation_conflict");
  }
  throw new Error(error?.message ?? "canonical run call failed");
}

/** The client MUST be the authenticated per-request client (RLS as user). */
export function createSupabaseCanonicalRunRepository(
  supabase: SupabaseClient,
): CanonicalRunRepository {
  return {
    async requestRun(input) {
      const { data, error } = await supabase.rpc("steward_request_canonical_run", {
        p_organization_id: input.orgId,
        p_task_id: input.taskId,
        p_action: input.action,
        p_operation_id: input.operationId,
        p_input_refs: input.snapshot.map((s) => ({ kind: s.kind, id: s.id })),
      });
      if (error) rethrow(error);
      return mapRun(data as RunRow);
    },
    async claimRun(runId, _actorId, leaseSeconds) {
      const { data, error } = await supabase.rpc("steward_claim_canonical_run", {
        p_run_id: runId,
        p_lease_seconds: leaseSeconds ?? 300,
      });
      if (error) rethrow(error);
      const row = data as RunRow | null;
      return row?.id ? mapRun(row) : null;
    },
    async completeRun(input) {
      const { data, error } = await supabase.rpc("steward_complete_canonical_run", {
        p_run_id: input.runId,
        p_claim_token: input.claimToken,
        p_artifact: input.artifactText,
        p_evidence_refs: input.evidenceRefs,
      });
      if (error) rethrow(error);
      return mapRun(data as RunRow);
    },
    async failRun(input) {
      const { data, error } = await supabase.rpc("steward_fail_canonical_run", {
        p_run_id: input.runId,
        p_claim_token: input.claimToken,
        p_reason: input.reason,
      });
      if (error) rethrow(error);
      return mapRun(data as RunRow);
    },
    async readInput(ref: CanonicalRunInputRef, orgId) {
      const { data, error } = await supabase.rpc("steward_resolve_input", {
        p_organization_id: orgId,
        p_kind: ref.kind,
        p_id: ref.id,
      });
      if (error) rethrow(error);
      const rows = data as { content: string; revision: number }[] | null;
      return rows && rows.length > 0 ? rows[0] : null;
    },
    async readTaskTitle(taskId, orgId) {
      const { data, error } = await supabase
        .from("steward_tasks")
        .select("title")
        .eq("id", taskId)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) rethrow(error);
      return (data as { title: string } | null)?.title ?? null;
    },
  };
}
