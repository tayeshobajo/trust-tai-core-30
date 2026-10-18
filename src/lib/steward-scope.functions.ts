/**
 * STAGED — CAPABILITY-GATED OFF. Protected server entrypoints for durable
 * meeting scope membership (required work denominator, archived retention,
 * audited amendments), consuming the real `createSupabaseScopeRepository`
 * adapter over the caller's RLS session (Trust Tai backend only).
 *
 * The capability flag `STEWARD_SCOPE_ENABLED` defaults to OFF and must
 * stay off until the UNAPPLIED patch
 * `docs/proposed/steward-backend/005_scope_membership.up.sql` is reviewed,
 * applied, and granted. While off, every entrypoint returns an honest
 * `unavailable` state and touches nothing.
 *
 * Scope can never shrink silently: amendments are explicit, reasoned,
 * operation-audited actions, and archived items stay in the denominator.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";
import {
  createSupabaseScopeRepository,
  type ScopeCounts,
  type ScopeItem,
} from "./steward-scope.supabase";
import { classifyMutationError } from "./steward-mutation-outcome";

export type ScopeCapabilityState = { kind: "unavailable"; reason: string } | { kind: "enabled" };

export type ScopeReadState =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; counts: ScopeCounts; items: ScopeItem[] }
  | { kind: "rejected"; message: string };

export type ScopeMutationState =
  | { kind: "unavailable"; reason: string }
  | { kind: "applied"; item: ScopeItem }
  | { kind: "rejected"; message: string }
  /* Transport ambiguity after send: the mutation may be durable. The
     caller keeps the pending operation for a same-id replay. */
  | { kind: "uncertain"; message: string };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_SCOPE_ENABLED"] === "true";
}

const DISABLED_REASON =
  "Durable meeting scope is not available yet: the reviewed scope contract is not applied. Recorded scope is unchanged.";

const meetingInputSchema = z.object({
  orgId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

export const getScopeCapabilityFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .handler(async (): Promise<ScopeCapabilityState> => {
    return capabilityEnabled()
      ? { kind: "enabled" }
      : { kind: "unavailable", reason: DISABLED_REASON };
  });

/**
 * Read the current scope snapshot for one meeting: counts (denominator,
 * verified, pending proposals) plus the item list, all through RLS. This
 * is the ONLY source the meeting score may use when the contract is on.
 */
export const getMeetingScopeFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) => meetingInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ScopeReadState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseScopeRepository(context.supabase);
    try {
      const counts = await repo.counts(data.orgId, data.conversationId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed tables are not in generated types until the UNAPPLIED patches land
      const rls = context.supabase as any;
      const { data: rows, error } = await rls
        .from("steward_scope_items")
        .select("id, organization_id, conversation_id, task_id, classification, removed_at")
        .eq("organization_id", data.orgId)
        .eq("conversation_id", data.conversationId);
      if (error) return { kind: "rejected", message: "the scope items could not be read" };
      const items: ScopeItem[] = (rows ?? []).map((row: Record<string, unknown>) => ({
        id: row["id"] as string,
        organizationId: row["organization_id"] as string,
        conversationId: row["conversation_id"] as string,
        taskId: row["task_id"] as string,
        classification: row["classification"] as ScopeItem["classification"],
        removedAt: (row["removed_at"] as string | null) ?? null,
      }));
      return { kind: "ready", counts, items };
    } catch (error) {
      return {
        kind: "rejected",
        message: error instanceof Error ? error.message : "scope could not be read",
      };
    }
  });

/** Add a task to the meeting's required scope (explicit human action). */
export const addScopeItemFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    meetingInputSchema
      .extend({
        taskId: z.string().uuid(),
        classification: z.enum(["transcript", "manual_required"]),
        operationId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ScopeMutationState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseScopeRepository(context.supabase);
    try {
      const item = await repo.addItem({
        orgId: data.orgId,
        conversationId: data.conversationId,
        taskId: data.taskId,
        classification: data.classification,
        operationId: data.operationId,
      });
      return { kind: "applied", item };
    } catch (error) {
      return {
        kind: "rejected",
        message: error instanceof Error ? error.message : "scope item could not be added",
      };
    }
  });

/**
 * Explicit durable sync of recorded required-manual tasks into the
 * meeting scope. Idempotent per operation UUID; never creates or edits
 * tasks and never resets prior human decisions. Runs only from an explicit
 * user gesture — never on mount, selection, or timers.
 */
export const syncRequiredScopeFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    meetingInputSchema.extend({ operationId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<ScopeMutationState | { kind: "applied" }> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseScopeRepository(context.supabase);
    try {
      await repo.syncRequired({
        orgId: data.orgId,
        conversationId: data.conversationId,
        operationId: data.operationId,
      });
      return { kind: "applied" };
    } catch (error) {
      return {
        kind: "rejected",
        message: error instanceof Error ? error.message : "required scope could not be synced",
      };
    }
  });

/**
 * Amend scope by removing an item — explicit, reasoned, audited. The item
 * stays in history; the operation UUID makes retries replay-safe.
 */
export const amendScopeItemFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    meetingInputSchema
      .extend({
        itemId: z.string().uuid(),
        reason: z.string().min(10).max(4000),
        operationId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ScopeMutationState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseScopeRepository(context.supabase);
    try {
      const item = await repo.amendRemove({
        orgId: data.orgId,
        conversationId: data.conversationId,
        itemId: data.itemId,
        reason: data.reason,
        operationId: data.operationId,
      });
      return { kind: "applied", item };
    } catch (error) {
      return {
        kind: "rejected",
        message: error instanceof Error ? error.message : "scope amendment could not be applied",
      };
    }
  });
