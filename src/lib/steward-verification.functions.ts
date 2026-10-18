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
import {
  createSupabaseVerificationRepository,
  foldVerificationProjection,
  readMeetingVerificationProjection,
  readSelectedTaskVerification,
} from "./steward-verification.supabase";
import {
  reopenCanonicalTask,
  verifyCanonicalTask,
  type ReopenResult,
  type TaskReceipt,
  type VerificationResult,
} from "./steward-verification.server";

export type VerificationCapabilityState =
  { kind: "unavailable"; reason: string } | { kind: "enabled" };

export type VerificationActionState =
  { kind: "unavailable"; reason: string } | VerificationResult | ReopenResult;

export interface TaskVerificationRead {
  /**
   * Current status + revision from the ONE-statement verification
   * projection — the same snapshot that produced `verified`. This revision
   * is the one a verify/reopen gesture captures as expectedRevision.
   */
  task: { id: string; status: "open" | "complete"; revision: number };
  /** Bounded display history (latest 100, chronological). Never used to
      derive `verified`. */
  receipts: TaskReceipt[];
  /** True when older receipts exist beyond the 100 shown. */
  historyTruncated: boolean;
  /**
   * Receipt-backed verified state from the projection RPC: complete AND the
   * latest receipt (task_revision_after DESC, created_at DESC, id DESC) is a
   * verify at the CURRENT revision. Raw board "complete" alone is never
   * verified.
   */
  verified: boolean;
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
 * Read one task's verified truth from the projection RPC (single id) plus a
 * bounded, disclosed display history. Unknown (missing, personal,
 * cross-org, inaccessible) is rejected — never inferred from history rows.
 */
export const getTaskVerificationStateFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), taskId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<VerificationReadState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    return readSelectedTaskVerification(context.supabase, data.orgId, data.taskId);
  });

export type MeetingVerificationProjectionState =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      /** taskId → receipt-backed verified, for every READABLE task. */
      verified: Record<string, boolean>;
      /** Requested ids that were missing or inaccessible — unknown,
          never silently counted as unverified. */
      unknown: string[];
      truncated: boolean;
    }
  | { kind: "rejected"; message: string };

const PROJECTION_LIMIT = 100;

/**
 * Bounded canonical verification projection for the visible tasks of one
 * meeting, so full-meeting counts/filters never depend on only the
 * SELECTED task's read. Same receipt-backed criterion as the scope SQL.
 * More than 100 task ids is rejected as truncated rather than silently
 * partial.
 */
export const getMeetingVerificationProjectionFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    z
      .object({
        orgId: z.string().uuid(),
        taskIds: z.array(z.string().uuid()).max(500),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<MeetingVerificationProjectionState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const uniqueIds = Array.from(new Set(data.taskIds));
    if (uniqueIds.length === 0)
      return { kind: "ready", verified: {}, unknown: [], truncated: false };
    if (uniqueIds.length > PROJECTION_LIMIT) {
      return {
        kind: "rejected",
        message: `too many tasks for one consistent read (${uniqueIds.length} > ${PROJECTION_LIMIT}); verified counts are unknown, not zero`,
      };
    }
    // ONE statement snapshot via the proposed read-only RPC: latest
    // receipt per task + current revision together, so a truncated
    // receipt list can never produce a false verified. Requested ids the
    // caller cannot read come back in `missing` — unknown, never false.
    const { rows, error } = await readMeetingVerificationProjection(
      context.supabase,
      data.orgId,
      uniqueIds,
    );
    if (error) {
      return { kind: "rejected", message: "the verification projection could not be read" };
    }
    if (!rows) {
      return { kind: "rejected", message: "the verification projection could not be read" };
    }
    // Unknown = requested minus returned (covers zero visible rows, where
    // no row exists to carry `missing`) — never false.
    const { verified, unknown } = foldVerificationProjection(uniqueIds, rows);
    return { kind: "ready", verified, unknown, truncated: false };
  });
