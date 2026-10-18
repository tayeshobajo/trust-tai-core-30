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
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createSupabaseCanonicalRunRepository } from "./steward-canonical-run.supabase";
import {
  CANONICAL_RUN_ACTIONS,
  executeCanonicalRun,
  type CanonicalRunProvider,
  type ExecuteCanonicalRunResult,
} from "./steward-canonical-run.server";

export type CanonicalRunCapabilityState =
  | { kind: "unavailable"; reason: string }
  | { kind: "enabled" };

export type CanonicalRunRequestState =
  | { kind: "unavailable"; reason: string }
  | { kind: "queued"; runId: string }
  | { kind: "replayed"; runId: string }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string };

export type CanonicalRunWorkerState =
  | { kind: "unavailable"; reason: string }
  | { kind: "result"; result: ExecuteCanonicalRunResult };

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
      const run = await repo.requestRun({
        orgId: data.orgId,
        taskId: data.taskId,
        action: data.action,
        operationId: data.operationId,
        digest: "", // computed server-side by the SQL function
        inputRefs: data.inputRefs,
        actorId: context.userId,
      });
      return {
        kind: run.status === "queued" && run.attempts === 0 ? "queued" : "replayed",
        runId: run.id,
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : "request failed";
      if (code === "P0002" || message.includes("operation_conflict")) {
        return { kind: "conflict", message: "this operation was already requested with different inputs" };
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const repo = createSupabaseCanonicalRunRepository(supabaseAdmin);
    // Default provider: none configured — fail honestly. A real provider is
    // wired only after separate review; tests inject a fake.
    const provider: CanonicalRunProvider = {
      async generate() {
        throw new Error("no canonical-run provider configured");
      },
    };
    const result = await executeCanonicalRun(repo, provider, {
      runId: data.runId,
      actorId: context.userId,
    });
    return { kind: "result", result };
  });

export const getCanonicalRunCapability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<CanonicalRunCapabilityState> => {
    return capabilityEnabled() ? { kind: "enabled" } : DISABLED;
  });
