/**
 * STAGED — CAPABILITY-GATED OFF. Protected server entrypoints for the
 * canonical Steward preparation runner. The capability flag
 * `STEWARD_CANONICAL_RUNS_ENABLED` defaults to OFF and must stay off until
 * the UNAPPLIED SQL patches in `docs/proposed/steward-backend/` are
 * reviewed, applied, and granted; with the flag off every entrypoint
 * returns the same honest `unavailable` state the UI already shows.
 *
 * Authority split (enforced by the SQL, not here):
 * - Request: authenticated user via RLS (auth.uid, active membership,
 *   write role, task authority). Input resolution and snapshotting happen
 *   INSIDE steward_request_canonical_run — this layer only transports
 *   {kind, id} refs and never resolves content client-side.
 * - Claim/complete/fail: service_role only. The worker path below uses the
 *   admin client precisely because those RPCs are not granted to
 *   authenticated — a signed-in client cannot forge an artifact.
 * - No provider is invoked unless the flag is on AND a provider is
 *   configured; the default provider throws, so an enabled-but-unconfigured
 *   deployment fails honestly instead of fabricating output.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createSupabaseCanonicalRunRepository } from "./steward-canonical-run.supabase";
import {
  authorizeRunWorkerCaller,
  CANONICAL_RUN_ACTIONS,
  executeCanonicalRun,
  type ExecuteCanonicalRunResult,
} from "./steward-canonical-run.server";
import {
  canonicalRunProviderStatus,
  createCanonicalRunProvider,
} from "./steward-canonical-run.provider.server";

export type CanonicalRunCapabilityState =
  { kind: "unavailable"; reason: string } | { kind: "enabled" };

export type CanonicalRunRequestState =
  | { kind: "unavailable"; reason: string }
  | { kind: "queued"; runId: string }
  | { kind: "replayed"; runId: string }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string };

export type CanonicalRunWorkerState =
  { kind: "unavailable"; reason: string } | { kind: "result"; result: ExecuteCanonicalRunResult };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_CANONICAL_RUNS_ENABLED"] === "true";
}

const DISABLED_REASON =
  "Canonical preparation runs are not available yet: the reviewed backend contract is not applied. Nothing was queued or executed.";

const DISABLED: CanonicalRunCapabilityState = { kind: "unavailable", reason: DISABLED_REASON };

const requestInputSchema = z.object({
  orgId: z.string().uuid(),
  taskId: z.string().uuid(),
  action: z.enum(CANONICAL_RUN_ACTIONS),
  operationId: z.string().uuid(),
  inputRefs: z
    .array(z.object({ kind: z.enum(["transcript", "task_notes"]), id: z.string().uuid() }))
    .min(1)
    .max(10),
});

export const requestCanonicalRunFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => requestInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<CanonicalRunRequestState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseCanonicalRunRepository(context.supabase);
    try {
      // The SQL function derives the actor from auth.uid(), validates
      // authority, resolves and snapshots the inputs, and computes the
      // request digest — this layer only transports the refs.
      const { run, replayed } = await repo.requestRun({
        orgId: data.orgId,
        taskId: data.taskId,
        action: data.action,
        operationId: data.operationId,
        digest: "", // computed server-side by the SQL function
        inputRefs: data.inputRefs,
        actorId: context.userId,
      });
      return {
        kind: replayed ? "replayed" : "queued",
        runId: run.id,
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : "request failed";
      if (code === "P0002" || message.includes("operation_conflict")) {
        return {
          kind: "conflict",
          message: "this operation was already requested with different inputs",
        };
      }
      return { kind: "rejected", message };
    }
  });

/**
 * Worker path: claims and executes ONE queued run. Uses the admin client
 * because claim/complete/fail are granted to service_role only — a
 * signed-in client can never mint an artifact. Still requires the caller
 * to be an authenticated org member so the endpoint is not public; the SQL
 * re-validates the run's original requester on every transition.
 */
export const runCanonicalRunWorkerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ runId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<CanonicalRunWorkerState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    // Provider readiness is checked BEFORE any claim so a missing
    // configuration reports unavailable instead of stranding a run.
    const providerStatus = canonicalRunProviderStatus();
    if (!providerStatus.configured) {
      return { kind: "unavailable", reason: providerStatus.reason ?? DISABLED_REASON };
    }
    // Authorize the CALLER against the run's org and canonical task through
    // their own RLS view BEFORE any privileged transition. The admin
    // repository validates the run's ORIGINAL requester, not this caller —
    // without this check any authenticated user could trigger and read
    // another org's run/artifact by supplying an arbitrary runId. RLS
    // returns nothing for an inaccessible run, so a foreign runId is
    // indistinguishable from a nonexistent one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed tables are not in generated types until the UNAPPLIED patches land
    const rls = context.supabase as any;
    const { data: run } = await rls
      .from("steward_canonical_runs")
      .select("id, organization_id, task_id")
      .eq("id", data.runId)
      .maybeSingle();
    if (!run) {
      return { kind: "unavailable", reason: "this run is not available to you" };
    }
    const { data: membership } = await rls
      .from("organization_memberships")
      .select("organization_id")
      .eq("organization_id", run.organization_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) {
      return { kind: "unavailable", reason: "this run is not available to you" };
    }
    const { data: task } = await rls
      .from("steward_tasks")
      .select("visibility, owner_user_id, created_by")
      .eq("organization_id", run.organization_id)
      .eq("id", run.task_id)
      .maybeSingle();
    const denial = authorizeRunWorkerCaller({
      run: { organizationId: run.organization_id, taskId: run.task_id },
      isActiveMember: Boolean(membership),
      task,
      callerId: context.userId,
    });
    if (denial) {
      return { kind: "unavailable", reason: denial };
    }
    const token =
      getRequest()
        .headers.get("authorization")
        ?.replace(/^Bearer\s+/i, "") ?? "";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const repo = createSupabaseCanonicalRunRepository(supabaseAdmin);
    const result = await executeCanonicalRun(
      repo,
      createCanonicalRunProvider({ token, organizationId: run.organization_id }),
      { runId: data.runId, actorId: context.userId },
    );
    return { kind: "result", result };
  });

export const getCanonicalRunCapability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<CanonicalRunCapabilityState> => {
    return capabilityEnabled() ? { kind: "enabled" } : DISABLED;
  });
