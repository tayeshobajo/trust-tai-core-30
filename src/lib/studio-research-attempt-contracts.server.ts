/** Additive v2 protocol. Legacy approvals and receipt validators are intentionally unchanged. */
import { z } from "zod";
import { type KeyObject } from "node:crypto";
import {
  approvalSchema,
  COORDINATOR,
  digest,
  type Approval,
} from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import {
  TIMING_POLICY_DIGEST,
  timingBindingSchema,
  timingEventSchema,
  type TimingBinding,
} from "./studio-research-timing-candidate.server";
const uuid = z.string().uuid(),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
export const attemptApprovalSchema = z
  .object({
    version: z.literal(2),
    attemptId: uuid,
    runId: uuid,
    priorRunId: uuid,
    nonce: uuid,
    sessionId: z.string().regex(/^ses_[0-9a-f-]{36}$/),
    historicalApproval: approvalSchema,
    subjectId: uuid,
    approvedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    policyDigest: z.literal(TIMING_POLICY_DIGEST),
    duplicateCostAccepted: z.literal(true),
  })
  .strict();
export type AttemptApproval = z.infer<typeof attemptApprovalSchema>;
export function parseAttemptApproval(raw: unknown): AttemptApproval {
  const a = attemptApprovalSchema.parse(raw);
  if (
    a.runId === a.priorRunId ||
    a.attemptId === a.historicalApproval.request.requestId ||
    a.subjectId !== a.historicalApproval.approvedBy ||
    a.historicalApproval.request.organizationId !== COORDINATOR.organizationId ||
    a.approvedAt < a.historicalApproval.approvedAt ||
    a.expiresAt <= a.approvedAt ||
    a.expiresAt - a.approvedAt > 900000 ||
    a.historicalApproval.draftRequested ||
    a.historicalApproval.voiceExamples.length !== 0 ||
    a.historicalApproval.approvedUrls.length !== 1 ||
    a.historicalApproval.approvedUrls[0] !== "https://www.iana.org/help/example-domains"
  )
    throw Error("attempt_approval_invalid");
  return a;
}
export function assertAttemptCurrent(a: AttemptApproval, now: number) {
  if (!Number.isSafeInteger(now) || now < a.approvedAt || now >= a.expiresAt)
    throw Error("attempt_expired");
}
export function attemptBinding(a: AttemptApproval): TimingBinding {
  return timingBindingSchema.parse({
    attemptId: a.attemptId,
    priorRunId: a.priorRunId,
    runId: a.runId,
    requestId: a.historicalApproval.request.requestId,
    issueId: a.historicalApproval.issueId,
    subjectId: a.subjectId,
    organizationId: a.historicalApproval.request.organizationId,
    companyId: COORDINATOR.companyId,
    projectId: COORDINATOR.projectId,
    agentId: COORDINATOR.agentId,
    sourceDigest: digest(a.historicalApproval.approvedUrls),
    approvalDigest: digest(a),
  });
}
/** Only used by existing prompt/source/result validation, never as execution authority. */
export function attemptContentApproval(a: AttemptApproval): Approval {
  return a.historicalApproval;
}
export const phaseReceiptSchema = timingEventSchema
  .extend({
    domain: z.literal("studio-execution-phase/v2"),
    binding: timingBindingSchema,
    policyDigest: z.literal(TIMING_POLICY_DIGEST),
    sequence: z.number().int().min(0).max(63),
    previousDigest: sha.nullable(),
  })
  .strict();
export type PhaseReceipt = z.infer<typeof phaseReceiptSchema>;
const successSteps = [
  "prepare:begin",
  "prepare:complete",
  "admission:begin",
  "admission:complete",
  "final_authority:begin",
  "final_authority:complete",
  "launch:spawn_intent",
  "launch:spawn_observed",
  "provider:begin",
  "provider:complete",
  "cleanup:begin",
  "cleanup:complete",
];
/** Replays bounded immutable evidence; callback receipt time never extends execution authority. */
export function verifyPhaseChain(
  tokens: readonly string[],
  key: KeyObject,
  approval: AttemptApproval,
) {
  if (tokens.length > 64) throw Error("phase_limit");
  const binding = attemptBinding(approval);
  let previous: PhaseReceipt | undefined,
    failed = false,
    step = 0;
  const receipts: PhaseReceipt[] = [];
  for (const [sequence, token] of tokens.entries()) {
    if (typeof token !== "string" || token.length > 8192) throw Error("phase_invalid");
    const r = phaseReceiptSchema.parse(verifySignedJson(key, token));
    if (
      digest(r.binding) !== digest(binding) ||
      r.sequence !== sequence ||
      r.previousDigest !== (sequence ? digest(tokens[sequence - 1]) : null) ||
      r.at < approval.approvedAt ||
      r.phaseDeadline > r.totalDeadline ||
      r.totalDeadline > approval.expiresAt ||
      (previous && (r.at < previous.at || r.totalDeadline !== previous.totalDeadline))
    )
      throw Error("phase_binding_invalid");
    const first = receipts[0] ?? r;
    if (
      r.totalDeadline <= first.at ||
      r.totalDeadline > first.at + 60000 ||
      ((r.phase === "prepare" || r.phase === "admission" || r.phase === "final_authority") &&
        (r.phaseDeadline !== first.phaseDeadline || r.phaseDeadline > first.at + 20000))
    )
      throw Error("phase_deadline_invalid");
    if (r.event === "failed") {
      if (
        !r.code ||
        r.stopEvidence ||
        (!failed && r.phase !== (successSteps[step]?.split(":")[0] ?? "cleanup"))
      )
        throw Error("phase_failure_invalid");
      failed = true;
    } else if (r.event === "stop_observed") {
      if (!failed || step < 7 || !r.stopEvidence || r.code || r.stopEvidence === "not_attempted")
        throw Error("phase_stop_invalid");
    } else {
      if (
        failed ||
        r.code ||
        r.stopEvidence ||
        `${r.phase}:${r.event}` !== successSteps[step] ||
        r.at >= r.phaseDeadline ||
        r.at >= r.totalDeadline
      )
        throw Error("phase_transition_invalid");
      if (
        r.phase === "launch" &&
        (r.phaseDeadline > r.at + 5000 ||
          (previous?.phase === "launch" && r.phaseDeadline !== previous.phaseDeadline))
      )
        throw Error("launch_deadline_invalid");
      if (
        (r.phase === "provider" || r.phase === "cleanup") &&
        previous &&
        (previous.phase === "provider" || previous.phase === "cleanup") &&
        r.phaseDeadline !== previous.phaseDeadline
      )
        throw Error("provider_deadline_invalid");
      step++;
    }
    receipts.push(r);
    previous = r;
  }
  return { receipts, failed, complete: !failed && step === successSteps.length };
}
