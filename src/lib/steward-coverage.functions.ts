/**
 * STAGED — CAPABILITY-GATED OFF. Protected server entrypoints for durable
 * transcript-coverage attestation, consuming the real
 * `createSupabaseCoverageRepository` adapter over the caller's RLS session
 * (Trust Tai backend only).
 *
 * The capability flag `STEWARD_COVERAGE_ENABLED` defaults to OFF and must
 * stay off until the UNAPPLIED patch
 * `docs/proposed/steward-backend/003_coverage_attestation.up.sql` is
 * reviewed, applied, and granted. While off, every entrypoint returns an
 * honest `unavailable` state and reads/writes nothing from the proposed
 * tables.
 *
 * The transcript hash and scope version are derived INSIDE the SQL from
 * the stored conversation — the caller supplies neither, so coverage can
 * never be attested against a caller-invented hash.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";
import { createSupabaseCoverageRepository } from "./steward-coverage.supabase";
import type { CoverageAttestation } from "./steward-coverage.server";

export type CoverageCapabilityState = { kind: "unavailable"; reason: string } | { kind: "enabled" };

export type CoverageReadState =
  | { kind: "unavailable"; reason: string }
  | {
      kind: "ready";
      current: boolean;
      latest: CoverageAttestation | null;
    }
  | { kind: "rejected"; message: string };

export type CoverageAttestState =
  | { kind: "unavailable"; reason: string }
  | { kind: "attested"; attestation: CoverageAttestation }
  | { kind: "rejected"; message: string };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_COVERAGE_ENABLED"] === "true";
}

const DISABLED_REASON =
  "Transcript coverage attestation is not available yet: the reviewed coverage contract is not applied. Coverage stays unconfirmed.";

const meetingInputSchema = z.object({
  orgId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

export const getCoverageCapabilityFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .handler(async (): Promise<CoverageCapabilityState> => {
    return capabilityEnabled()
      ? { kind: "enabled" }
      : { kind: "unavailable", reason: DISABLED_REASON };
  });

/** Read current coverage + latest attestation for one meeting (RLS). */
export const getMeetingCoverageFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) => meetingInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<CoverageReadState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseCoverageRepository(context.supabase);
    try {
      const [current, latest] = await Promise.all([
        repo.currentCoverage({ orgId: data.orgId, conversationId: data.conversationId }),
        repo.latestAttestation(data.orgId, data.conversationId),
      ]);
      return { kind: "ready", current, latest };
    } catch (error) {
      return {
        kind: "rejected",
        message: error instanceof Error ? error.message : "coverage could not be read",
      };
    }
  });

/**
 * Attest coverage for the CURRENT stored transcript + scope version. An
 * explicit human gesture only; the SQL derives the hash server-side and
 * supersedes any prior attestation atomically, so a retry of the same
 * gesture is naturally safe. The client supplies a stable operation UUID
 * so an uncertain transport can be retried without a new gesture; the SQL
 * is keyed on the transcript hash, so the UUID is trace-only.
 */
export const attestMeetingCoverageFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    meetingInputSchema.extend({ operationId: z.string().uuid().optional() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<CoverageAttestState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseCoverageRepository(context.supabase);
    try {
      const attestation = await repo.attest({
        orgId: data.orgId,
        conversationId: data.conversationId,
      });
      return { kind: "attested", attestation };
    } catch (error) {
      return {
        kind: "rejected",
        message: error instanceof Error ? error.message : "coverage could not be attested",
      };
    }
  });
