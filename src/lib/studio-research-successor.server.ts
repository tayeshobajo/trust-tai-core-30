/** Offline/operator-only successor verification. No ambient keys, routes or network calls. */
import { z } from "zod";
import { sign, type KeyObject } from "node:crypto";
import { digest } from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import {
  assertAttemptCurrent,
  parseAttemptApproval,
  type AttemptApproval,
  type SuccessorApproval,
} from "./studio-research-attempt-contracts.server";
export function assertSuccessorPredecessor(
  next: SuccessorApproval,
  prior: AttemptApproval,
  now: number,
) {
  assertAttemptCurrent(next, now);
  if (
    prior.version !== 2 ||
    now < prior.expiresAt ||
    next.predecessorAttemptId !== prior.attemptId ||
    next.predecessorRunId !== prior.runId ||
    next.predecessorApprovalDigest !== digest(prior) ||
    next.predecessorExpiresAt !== prior.expiresAt ||
    next.priorRunId !== prior.priorRunId ||
    digest(next.historicalApproval) !== digest(prior.historicalApproval) ||
    next.subjectId !== prior.subjectId ||
    next.policyDigest !== prior.policyDigest ||
    next.nonce === prior.nonce ||
    next.sessionId === prior.sessionId
  )
    throw Error("successor_predecessor_invalid");
}
const attestationSchema = z
  .object({
    domain: z.literal("studio-successor-reservation/v1"),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    predecessorApprovalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    attemptId: z.string().uuid(),
    predecessorAttemptId: z.string().uuid(),
    priorRunId: z.string().uuid(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    predecessorUnclaimed: z.literal(true),
  })
  .strict();
/** Called only inside the host's atomic reservation after checking durable predecessor evidence. */
export function signSuccessorReservation(a: SuccessorApproval, key: KeyObject, now: number) {
  const value = attestationSchema.parse({
    domain: "studio-successor-reservation/v1",
    approvalDigest: digest(a),
    predecessorApprovalDigest: a.predecessorApprovalDigest,
    attemptId: a.attemptId,
    predecessorAttemptId: a.predecessorAttemptId,
    priorRunId: a.priorRunId,
    issuedAt: now,
    expiresAt: Math.min(now + 60000, a.expiresAt),
    predecessorUnclaimed: true,
  });
  const bytes = Buffer.from(JSON.stringify(value));
  return bytes.toString("base64url") + "." + sign(null, bytes, key).toString("base64url");
}
/** Service-role callback registration is a separate explicit operator step, never a run/read route. */
export function verifySuccessorRegistration(input: {
  approvalToken: string;
  reservationToken: string;
  pinnedApprovalDigest: string;
  studioKey: KeyObject;
  hostKey: KeyObject;
  predecessor: AttemptApproval;
  predecessorState: unknown;
  now: number;
}) {
  const a = parseAttemptApproval(verifySignedJson(input.studioKey, input.approvalToken));
  if (a.version !== 3 || digest(a) !== input.pinnedApprovalDigest)
    throw Error("successor_pin_invalid");
  assertSuccessorPredecessor(a, input.predecessor, input.now);
  const empty = {
    revision: 0,
    admission: null,
    tokens: [],
    terminal: null,
    cancelled: false,
    packetDigests: [],
    result: null,
  };
  if (digest(input.predecessorState) !== digest(empty))
    throw Error("successor_predecessor_consumed");
  const p = attestationSchema.parse(verifySignedJson(input.hostKey, input.reservationToken));
  if (
    p.approvalDigest !== digest(a) ||
    p.predecessorApprovalDigest !== a.predecessorApprovalDigest ||
    p.attemptId !== a.attemptId ||
    p.predecessorAttemptId !== a.predecessorAttemptId ||
    p.priorRunId !== a.priorRunId ||
    p.issuedAt < a.approvedAt ||
    p.issuedAt > input.now ||
    p.expiresAt <= input.now ||
    p.expiresAt > a.expiresAt ||
    p.expiresAt <= p.issuedAt ||
    p.expiresAt - p.issuedAt > 60000
  )
    throw Error("successor_reservation_invalid");
  return { approval: a, attestation: p, reservationToken: input.reservationToken };
}

/** Explicit operator entrypoint; adapters must perform an atomic DB insert with predecessor locking.
 * A failed/unknown insert is never retried here. Callers reconcile the exact reserved ID. */
export async function provisionCallbackSuccessor(
  input: Omit<
    Parameters<typeof verifySuccessorRegistration>[0],
    "predecessor" | "predecessorState"
  >,
  storage: {
    readPredecessor(id: string): Promise<{ approval: AttemptApproval; state: unknown }>;
    insert(row: {
      attempt_id: string;
      request_id: string;
      prior_run_id: string;
      predecessor_attempt_id: string;
      approval: SuccessorApproval;
      approval_digest: string;
      reservation_token: string;
      reservation: unknown;
    }): Promise<void>;
  },
) {
  const candidate = parseAttemptApproval(verifySignedJson(input.studioKey, input.approvalToken));
  if (candidate.version !== 3) throw Error("successor_pin_invalid");
  const prior = await storage.readPredecessor(candidate.predecessorAttemptId);
  const verified = verifySuccessorRegistration({
    ...input,
    predecessor: prior.approval,
    predecessorState: prior.state,
  });
  const a = verified.approval;
  await storage.insert({
    attempt_id: a.attemptId,
    request_id: a.historicalApproval.request.requestId,
    prior_run_id: a.priorRunId,
    predecessor_attempt_id: a.predecessorAttemptId,
    approval: a,
    approval_digest: digest(a),
    reservation_token: verified.reservationToken,
    reservation: verified.attestation,
  });
}
