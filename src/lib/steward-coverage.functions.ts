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
import { classifyMutationError } from "./steward-mutation-outcome";

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
  | { kind: "rejected"; message: string }
  /* Transport ambiguity after send: the attestation may be durable. The
     caller keeps the pending operation for a same-id replay. */
  | { kind: "uncertain"; message: string };

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
 * Attest coverage of the source the human ACTUALLY REVIEWED. The client
 * supplies the transcript hash + scope version from the consistent score
 * snapshot it displayed; the SQL derives the CURRENT stored values itself
 * and rejects the attestation when they differ, so a transcript or scope
 * change during review is never silently attested. The operation UUID is
 * load-bearing: an uncertain-transport retry replays the SAME attestation
 * (same operation + same reviewed source) instead of attesting whatever
 * is current at retry time.
 */
export const attestMeetingCoverageFn = createServerFn({ method: "POST" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    meetingInputSchema
      .extend({
        operationId: z.string().uuid(),
        expectedTranscriptHash: z.string().min(16),
        expectedScopeVersion: z.number().int().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CoverageAttestState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    const repo = createSupabaseCoverageRepository(context.supabase);
    try {
      const attestation = await repo.attest({
        orgId: data.orgId,
        conversationId: data.conversationId,
        operationId: data.operationId,
        expectedTranscriptHash: data.expectedTranscriptHash,
        expectedScopeVersion: data.expectedScopeVersion,
      });
      return { kind: "attested", attestation };
    } catch (error) {
      const message = error instanceof Error ? error.message : "coverage could not be attested";
      if (message.includes("source_changed_since_review")) {
        return {
          kind: "rejected",
          message:
            "The transcript or scope changed since this review was read. Re-read the meeting, then attest again — the changed source was not attested.",
        };
      }
      /* Known contract answers are resolved rejections; transport/5xx/
         malformed responses after send are UNCERTAIN — the attestation
         may be durable, so the same operation must be replayed. */
      return classifyMutationError(error);
    }
  });
