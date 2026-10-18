/**
 * STAGED — NOT WIRED TO ANY ROUTE. Concrete Supabase adapter for the
 * canonical Steward preparation runner. Every call goes through the
 * proposed SQL functions via RPC as the authenticated user (RLS applies);
 * the adapter holds no authority of its own and never uses the admin
 * client. Unusable until the UNAPPLIED patches in
 * `docs/proposed/steward-backend/` are reviewed, applied, and granted.
 *
 * RPC boundary (must stay in sync with 001_canonical_runs.up.sql):
 * - steward_request_canonical_run(p_org, p_task, p_action, p_operation, p_input_refs)
 *   — input content is resolved and snapshotted INSIDE the SQL function;
 *   the client only sends {kind, id} refs. steward_resolve_input is
 *   intentionally NOT granted to authenticated, so this adapter never
 *   calls it: readInput throws to make that boundary explicit.
 * - steward_claim_canonical_run(p_run, p_lease_seconds) — service_role only.
 * - steward_complete_canonical_run(p_run, p_claim_token, p_artifact, p_evidence_refs)
 *   — service_role only.
 * - steward_fail_canonical_run(p_run, p_claim_token, p_reason) — service_role only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CanonicalRun,
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

/** The client MUST be the authenticated per-request client (RLS as user),
 *  except claim/complete/fail which require the service-role worker client
 *  (they are granted to service_role only). */
export function createSupabaseCanonicalRunRepository(
  supabase: SupabaseClient,
): CanonicalRunRepository {
  return {
    async requestRun(input) {
      const { data, error } = await supabase.rpc("steward_request_canonical_run", {
        p_org: input.orgId,
        p_task: input.taskId,
        p_action: input.action,
        p_operation: input.operationId,
        p_input_refs: input.inputRefs.map((s) => ({ kind: s.kind, id: s.id })),
      });
      if (error) rethrow(error);
      return mapRun(data as RunRow);
    },
    async claimRun(runId, _actorId, leaseSeconds) {
      const { data, error } = await supabase.rpc("steward_claim_canonical_run", {
        p_run: runId,
        p_lease_seconds: leaseSeconds ?? 300,
      });
      if (error) rethrow(error);
      const row = data as RunRow | null;
      return row?.id ? mapRun(row) : null;
    },
    async completeRun(input) {
      const { data, error } = await supabase.rpc("steward_complete_canonical_run", {
        p_run: input.runId,
        p_claim_token: input.claimToken,
        p_artifact: input.artifactText,
        p_evidence_refs: input.evidenceRefs,
      });
      if (error) rethrow(error);
      return mapRun(data as RunRow);
    },
    async failRun(input) {
      const { data, error } = await supabase.rpc("steward_fail_canonical_run", {
        p_run: input.runId,
        p_claim_token: input.claimToken,
        p_reason: input.reason,
      });
      if (error) rethrow(error);
      return mapRun(data as RunRow);
    },
    async readInput() {
      // steward_resolve_input is NOT granted to authenticated: input
      // resolution and snapshotting happen inside steward_request_canonical_run.
      // The Supabase request path therefore never resolves inputs client-side;
      // this method exists only for in-memory test repositories.
      throw new Error(
        "readInput is not available on the Supabase adapter: input resolution is server-side only",
      );
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
