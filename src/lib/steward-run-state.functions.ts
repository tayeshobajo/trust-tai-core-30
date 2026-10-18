/**
 * STAGED — CAPABILITY-GATED OFF. Read-state entrypoints for canonical
 * preparation runs: the run list, artifact text/digest and cited evidence
 * for one task, through the caller's RLS session (Trust Tai backend only).
 * Read-only; mutations live in `steward-canonical-run.functions.ts`.
 *
 * Shares the `STEWARD_CANONICAL_RUNS_ENABLED` flag with the request/worker
 * entrypoints: while the contract is unapplied, reads return the same
 * honest `unavailable` state and never touch the proposed tables.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";
import type { CanonicalRun } from "./steward-canonical-run.server";

export type RunReadState =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; runs: CanonicalRun[]; truncated: boolean }
  | { kind: "rejected"; message: string };

const DISABLED_REASON =
  "Canonical preparation runs are not available yet: the reviewed backend contract is not applied. No runs exist to show.";

function capabilityEnabled(): boolean {
  return process.env["STEWARD_CANONICAL_RUNS_ENABLED"] === "true";
}

const COLUMNS =
  "id, organization_id, task_id, action, client_operation_id, request_digest, input_snapshot, status, artifact_text, artifact_digest, evidence_refs, requested_by, attempts, max_attempts, failure_reason, claim_token, claim_version";

/** List canonical runs (newest first) for one canonical task. */
export const getTaskCanonicalRunsFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), taskId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<RunReadState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed tables are not in generated types until the UNAPPLIED patches land
    const rls = context.supabase as any;
    /* Fetch one row beyond the page so truncation is detected and
       disclosed — older history is never silently omitted. */
    const { data: rows, error } = await rls
      .from("steward_canonical_runs")
      .select(COLUMNS)
      .eq("organization_id", data.orgId)
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: false })
      .limit(21);
    if (error) return { kind: "rejected", message: "the run history could not be read" };
    const truncated = (rows ?? []).length > 20;
    const page = (rows ?? []).slice(0, 20);
    const runs: CanonicalRun[] = page.map((row: Record<string, unknown>) => ({
      id: row["id"] as string,
      organizationId: row["organization_id"] as string,
      taskId: row["task_id"] as string,
      action: row["action"] as CanonicalRun["action"],
      clientOperationId: row["client_operation_id"] as string,
      requestDigest: row["request_digest"] as string,
      inputSnapshot: (row["input_snapshot"] as CanonicalRun["inputSnapshot"] | null) ?? [],
      status: row["status"] as CanonicalRun["status"],
      artifactText: (row["artifact_text"] as string | null) ?? null,
      artifactDigest: (row["artifact_digest"] as string | null) ?? null,
      evidenceRefs: (row["evidence_refs"] as string[] | null) ?? [],
      requestedBy: row["requested_by"] as string,
      attempts: row["attempts"] as number,
      maxAttempts: row["max_attempts"] as number,
      failureReason: (row["failure_reason"] as string | null) ?? null,
      claimToken: (row["claim_token"] as string | null) ?? null,
      claimVersion: row["claim_version"] as number,
    }));
    return { kind: "ready", runs, truncated };
  });
