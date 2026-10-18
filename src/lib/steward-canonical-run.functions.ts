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
import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";
import { trustTaiWriter, trustTaiWriterConfigured } from "./trust-tai-writer.server";
import { createSupabaseCanonicalRunRepository } from "./steward-canonical-run.supabase";
import {
  authorizeWorkerEndpoint,
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
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) => requestInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<CanonicalRunRequestState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    // Provider readiness BEFORE queueing: an enabled-but-unconfigured
    // deployment must report unavailable instead of stranding a queued run.
    const providerStatus = canonicalRunProviderStatus();
    if (!providerStatus.configured) {
      return { kind: "unavailable", reason: providerStatus.reason ?? DISABLED_REASON };
    }
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
  .middleware([requireTrustTaiAuth])
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
    const authorization = await authorizeWorkerEndpoint(rls, {
      runId: data.runId,
      callerId: context.userId,
    });
    if ("denial" in authorization) {
      return { kind: "unavailable", reason: authorization.denial };
    }
    const run = authorization.run;
    const token =
      getRequest()
        .headers.get("authorization")
        ?.replace(/^Bearer\s+/i, "") ?? "";
    // The pinned Trust Tai writer (service key against the Trust Tai
    // project ONLY) — never the generic admin client, never another
    // database. Absence of the service key fails honestly as unavailable.
    if (!trustTaiWriterConfigured()) {
      return {
        kind: "unavailable",
        reason:
          "The worker's server access to the workspace database is not set up, so no run was claimed or executed.",
      };
    }
    const repo = createSupabaseCanonicalRunRepository(trustTaiWriter());
    const result = await executeCanonicalRun(
      repo,
      createCanonicalRunProvider({ token, organizationId: run.organizationId }),
      { runId: data.runId, actorId: context.userId },
    );
    return { kind: "result", result };
  });

export const getCanonicalRunCapability = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .handler(async (): Promise<CanonicalRunCapabilityState> => {
    if (!capabilityEnabled()) return DISABLED;
    // Enabled flag without a configured provider is still unavailable —
    // report the honest reason so the UI never promises a run that cannot
    // execute.
    const providerStatus = canonicalRunProviderStatus();
    if (!providerStatus.configured) {
      return { kind: "unavailable", reason: providerStatus.reason ?? DISABLED_REASON };
    }
    // The pinned Trust Tai writer must be configured BEFORE anything is
    // queueable: an enabled flag without worker server access would strand
    // queued runs that can never be claimed or completed.
    if (!trustTaiWriterConfigured()) {
      return {
        kind: "unavailable",
        reason:
          "The worker's server access to the workspace database is not set up, so no run can be queued or executed.",
      };
    }
    return { kind: "enabled" };
  });
