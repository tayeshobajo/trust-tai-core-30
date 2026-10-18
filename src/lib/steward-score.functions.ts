/**
 * STAGED — CAPABILITY-GATED OFF. Protected read-only entrypoint for the
 * CONSISTENT meeting-score snapshot: one SQL statement returns the
 * denominator, verified count, pending proposals, coverage currency and
 * source versions together, so the score card, navigation and bottom
 * explanation can never be assembled from mixed reads.
 *
 * The capability flag `STEWARD_SCORE_SNAPSHOT_ENABLED` defaults to OFF
 * and must stay off until the UNAPPLIED patch
 * `docs/proposed/steward-backend/006_meeting_score_snapshot.up.sql` is
 * reviewed, applied, and granted. While off, the entrypoint returns an
 * honest `unavailable` state and touches nothing.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireTrustTaiAuth } from "./steward-trust-tai-auth.server";

export interface MeetingScoreSnapshot {
  denominator: number;
  verified: number;
  pendingProposals: number;
  coverageCurrent: boolean;
  attestedAt: string | null;
  scopeVersion: number;
  complete: boolean;
}

export type MeetingScoreSnapshotState =
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; snapshot: MeetingScoreSnapshot }
  | { kind: "rejected"; message: string };

function capabilityEnabled(): boolean {
  return process.env["STEWARD_SCORE_SNAPSHOT_ENABLED"] === "true";
}

const DISABLED_REASON =
  "The consistent meeting score is not available yet: the reviewed snapshot contract is not applied. The score is not shown from mixed reads.";

export const getMeetingScoreSnapshotFn = createServerFn({ method: "GET" })
  .middleware([requireTrustTaiAuth])
  .inputValidator((data) =>
    z.object({ orgId: z.string().uuid(), conversationId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<MeetingScoreSnapshotState> => {
    if (!capabilityEnabled()) return { kind: "unavailable", reason: DISABLED_REASON };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- proposed tables are not in generated types until the UNAPPLIED patches land
    const rls = context.supabase as any;
    const { data: row, error } = await rls.rpc("steward_meeting_score_snapshot", {
      p_org: data.orgId,
      p_conversation: data.conversationId,
    });
    if (error) {
      return {
        kind: "rejected",
        message: "the meeting score could not be read as one consistent snapshot",
      };
    }
    const snapshot = row as Record<string, unknown> | null;
    if (
      !snapshot ||
      typeof snapshot["denominator"] !== "number" ||
      typeof snapshot["verified"] !== "number" ||
      typeof snapshot["pendingProposals"] !== "number" ||
      typeof snapshot["coverageCurrent"] !== "boolean" ||
      typeof snapshot["complete"] !== "boolean"
    ) {
      return { kind: "rejected", message: "the meeting score snapshot was malformed" };
    }
    return {
      kind: "ready",
      snapshot: {
        denominator: snapshot["denominator"],
        verified: snapshot["verified"],
        pendingProposals: snapshot["pendingProposals"],
        coverageCurrent: snapshot["coverageCurrent"],
        attestedAt: typeof snapshot["attestedAt"] === "string" ? snapshot["attestedAt"] : null,
        scopeVersion: typeof snapshot["scopeVersion"] === "number" ? snapshot["scopeVersion"] : 0,
        complete: snapshot["complete"],
      },
    };
  });
