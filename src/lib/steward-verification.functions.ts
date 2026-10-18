/**
 * STAGED — CAPABILITY-GATED OFF. Protected server entrypoints for atomic
 * evidence-backed verification/reopen of canonical Steward board tasks,
 * consuming the real `createSupabaseVerificationRepository` adapter over
 * the caller's RLS session (Trust Tai backend only).
 *
 * The capability flag `STEWARD_VERIFICATION_ENABLED` defaults to OFF and
 * must stay off until the UNAPPLIED patch
 * `docs/proposed/steward-backend/002_atomic_verification.up.sql` is
 * reviewed, applied, and granted. While off, every entrypoint returns the
 * same honest `unavailable` state and touches nothing.
 *
 * Replay safety: every mutation carries a client-supplied operation UUID;
 * the SQL returns {receipt, replayed} and a repeated operation replays the
 * durable receipt instead of re-executing. On post-commit transport
 * ambiguity the adapter returns the durable receipt with task: null — the
 * caller reconciles from the receipt and never infers failure from a
 * failed reread.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";
import { createSupabaseVerificationRepository } from "./steward-verification.supabase";
import {
  reopenCanonicalTask,
  verifyCanonicalTask,
  type ReopenResult,
  type TaskReceipt,
  type VerificationResult,
  type VerificationTaskState,
} from "./steward-verification.server";

export type VerificationCapabilityState =
  { kind: "unavailable"; reason: string } | { kind: "enabled" };

export type VerificationActionState =
  { kind: "unavailable"; reason: string } | VerificationResult | ReopenResult;

export interface TaskVerificationRead {
  task: VerificationTaskState | null;
  receipts: TaskReceipt[];
  /**
   * Receipt-backed verified state, computed with the SAME criteria as the
   * scope SQL: the task is complete AND its LATEST receipt is a verify
   * whose task_revision_after still equals the current revision. Raw board
   * "complete" status alone — no receipt, or an edit/reopen since — is
   * NEVER verified. `null` when the task row could not be read.
   */
  verified: boolean | null;
}

export type VerificationReadState =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; read: TaskVerificationRead }
  | { kind: "rejected"; message: string };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_VERIFICATION_ENABLED"] === "true";
}

const DISABLED_REASON =
  "Verified completion is not available yet: the reviewed atomic verification contract is not applied. Nothing was changed.";

const DISABLED: VerificationCapabilityState = { kind: "unavailable", reason: DISABLED_REASON };

const mutationInputSchema = z.object({
  orgId: z.string().uuid(),
  taskId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  operationId: z.string().uuid(),
  note: z.string().min(10).max(4000),
});

export const getVerificationCapabilityFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .handler(async (): Promise<VerificationCapabilityState> => {
    return capabilityEnabled() ? { kind: "enabled" } : DISABLED;
  });

/** Verify a canonical task: substantive note + expected revision, one RPC. */
export const verifyCanonicalTaskFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) => mutationInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<VerificationActionState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseVerificationRepository(context.supabase);
    return verifyCanonicalTask(repo, {
      orgId: data.orgId,
      taskId: data.taskId,
      expectedRevision: data.expectedRevision,
      operationId: data.operationId,
      note: data.note,
      actorId: context.userId,
    });
  });

/** Reopen a canonical task: reason required, history preserved. */
export const reopenCanonicalTaskFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) => mutationInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<VerificationActionState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseVerificationRepository(context.supabase);
    return reopenCanonicalTask(repo, {
      orgId: data.orgId,
      taskId: data.taskId,
      expectedRevision: data.expectedRevision,
      operationId: data.operationId,
      reason: data.note,
      actorId: context.userId,
    });
  });

/**
 * Read the current verification state and durable receipts for one task
 * through RLS. Read-only; available whenever the flag is on.
 */
export const getTaskVerificationStateFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), taskId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<VerificationReadState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed tables are not in generated types until the UNAPPLIED patches land
    const rls = context.supabase as any;
    const { data: task, error: taskError } = await rls
      .from("steward_tasks")
      .select("id, status, revision, completion_evidence, completed_at, completed_by")
      .eq("id", data.taskId)
      .eq("organization_id", data.orgId)
      .maybeSingle();
    if (taskError) return { kind: "rejected", message: "the task state could not be read" };
    if (!task) return { kind: "rejected", message: "task not found" };
    const { data: receipts, error: receiptError } = await rls
      .from("steward_task_receipts")
      .select("id, organization_id, task_id, operation_id, kind, note, actor_id, created_at")
      .eq("organization_id", data.orgId)
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true });
    if (receiptError) {
      return { kind: "rejected", message: "the receipt history could not be read" };
    }
    return {
      kind: "ready",
      read: {
        task: {
          id: task.id,
          status: task.status,
          revision: task.revision,
          completionEvidence: task.completion_evidence,
          completedAt: task.completed_at,
          completedBy: task.completed_by,
        },
        receipts: (receipts ?? []).map((row: Record<string, unknown>) => ({
          id: row["id"],
          organizationId: row["organization_id"],
          taskId: row["task_id"],
          operationId: row["operation_id"],
          kind: row["kind"] === "reopen" ? ("reopen" as const) : ("verify" as const),
          note: row["note"],
          actorId: row["actor_id"],
          createdAt: row["created_at"],
        })),
      },
    };
  });
