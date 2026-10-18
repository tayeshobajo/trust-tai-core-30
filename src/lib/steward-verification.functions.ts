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
    // ONE statement snapshot via the proposed read-only RPC: latest
    // receipt per task + current revision together, so a truncated
    // receipt list can never produce a false verified. Requested ids the
    // caller cannot read come back in `missing` — unknown, never false.
    const { data: rows, error } = await rls.rpc("steward_meeting_verification_projection", {
      p_org: data.orgId,
      p_task_ids: uniqueIds,
    });
    if (error) {
      return { kind: "rejected", message: "the verification projection could not be read" };
    }
    const verified: Record<string, boolean> = {};
    const unknown: string[] = [];
    for (const row of rows ?? []) {
      if (row.verified === true || row.verified === false) {
        verified[row.task_id] = row.verified;
      }
      for (const missingId of row.missing ?? []) {
        unknown.push(missingId);
      }
    }
    return { kind: "ready", verified, unknown, truncated: false };
  });
