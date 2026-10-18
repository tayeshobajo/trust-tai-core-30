/**
 * STAGED — CAPABILITY-GATED OFF. Protected server entrypoints for the
 * canonical Steward preparation runner. The capability flag
 * `STEWARD_CANONICAL_RUNS_ENABLED` defaults to OFF and must stay off until
 * the UNAPPLIED SQL patches in `docs/proposed/steward-backend/` are
 * reviewed, applied, and granted; with the flag off every entrypoint
 * returns the same honest `unavailable` state the UI already shows.
 *
 * Even when enabled, all authority lives in the SQL functions (auth.uid,
 * active membership, write role, task authority, fencing tokens); these
 * functions only transport the call as the authenticated user. No provider
 * is invoked here — execution requires a separately reviewed worker.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createSupabaseCanonicalRunRepository } from "./steward-canonical-run.supabase";
import {
  CANONICAL_RUN_ACTIONS,
  requestCanonicalRun,
  type RequestCanonicalRunResult,
} from "./steward-canonical-run.server";

export type CanonicalRunCapabilityState =
  { kind: "unavailable"; reason: string } | { kind: "result"; result: RequestCanonicalRunResult };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_CANONICAL_RUNS_ENABLED"] === "true";
}

const DISABLED: CanonicalRunCapabilityState = {
  kind: "unavailable",
  reason:
    "Canonical preparation runs are not available yet: the reviewed backend contract is not applied. Nothing was queued or executed.",
};

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
  .handler(async ({ data, context }): Promise<CanonicalRunCapabilityState> => {
    if (!capabilityEnabled()) return DISABLED;
    const repo = createSupabaseCanonicalRunRepository(context.supabase);
    const result = await requestCanonicalRun(repo, {
      orgId: data.orgId,
      taskId: data.taskId,
      action: data.action,
      operationId: data.operationId,
      inputRefs: data.inputRefs,
      actorId: context.userId,
    });
    return { kind: "result", result };
  });

export const getCanonicalRunCapability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<CanonicalRunCapabilityState> => {
    if (!capabilityEnabled()) return DISABLED;
    return DISABLED;
  });
