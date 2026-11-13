/** Receipt verification only. No command authentication, launch signer or approval issuance. */
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import {
  cliAccountingSchema,
  approvalSchema,
  coordinatorPrompt,
  digest,
  profileSchema,
  validateBrief,
  type Approval,
} from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import { receiptSchema } from "./studio-research-output.server";
import { validateSourceReceipt } from "./studio-research-manual-test.server";
import type { SourceEvidence } from "./studio-research-source-evidence.server";
import type {
  CoordinatorRequestStore,
  CoordinatorRow,
} from "./studio-research-coordinator-request-store.server";
const receiptEnvelope = z
  .object({
    issuer: z.literal("studio-coordinator-receipt"),
    audience: z.literal("studio-existing-request"),
    stage: z.enum(["admission", "result"]),
    issuedAt: z.number().finite(),
    expiresAt: z.number().finite(),
    job: z.unknown(),
  })
  .strict();
const launchSchema = z
  .object({
    nonce: z.string().uuid(),
    profile: profileSchema,
    startedAt: z.number().finite(),
    launchDeadline: z.number().finite(),
    completionDeadline: z.number().finite(),
  })
  .strict();
function bound(row: CoordinatorRow, a: Approval) {
  return (
    row.state === "submitted" &&
    row.result === null &&
    row.result_comment_id === null &&
    row.organization_id === a.request.organizationId &&
    row.request_id === a.request.requestId &&
    row.topic === a.request.topic &&
    row.created_by === a.approvedBy &&
    row.company_id === a.companyId &&
    row.agent_id === a.agentId &&
    row.issue_id === a.issueId
  );
}
function storedApproval(row: CoordinatorRow) {
  const a = approvalSchema.parse(row.coordinator_approval);
  if (!bound(row, a) || digest(a) !== row.coordinator_approval_digest)
    throw Error("binding_invalid");
  return a;
}
export function createStudioReceiptReceiver(d: {
  store: CoordinatorRequestStore;
  enabled: boolean;
  receiptPublicKey?: KeyObject;
  now(): number;
}) {
  return async (token: unknown) => {
    if (!d.enabled) throw Error("coordinator_disabled");
    if (!d.receiptPublicKey) throw Error("receipt_unavailable");
    try {
      const e = receiptEnvelope.parse(verifySignedJson(d.receiptPublicKey, token));
      if (
        e.issuedAt > d.now() ||
        e.expiresAt <= d.now() ||
        e.expiresAt <= e.issuedAt ||
        e.expiresAt - e.issuedAt > 60000
      )
        throw Error();
      const job = z
        .object({
          id: z.string().uuid(),
          state: z.enum(["running", "ready"]),
          revision: z.number().int().nonnegative(),
          approval: approvalSchema,
          approvalDigest: z.string(),
          data: z
            .object({
              runId: z.string().uuid(),
              sessionId: z.string().min(1).max(200),
              evidence: z.array(z.unknown()).min(1).max(3),
              evidenceDigest: z.string(),
              promptDigest: z.string(),
              launch: launchSchema,
              result: z.unknown().optional(),
              resultDigest: z.string().optional(),
              completion: z
                .object({
                  receipt: receiptSchema,
                  outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
                  providerRequests: z.null(),
                  accounting: cliAccountingSchema,
                  completedAt: z.number().finite(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        })
        .strict()
        .parse(e.job);
      let row = await d.store.read(job.approval.request.organizationId, job.id);
      if (!row) throw Error();
      const a = storedApproval(row),
        evidence = job.data.evidence as SourceEvidence[];
      validateSourceReceipt(a, evidence);
      const launch = job.data.launch;
      if (
        digest(a) !== job.approvalDigest ||
        digest(a) !== digest(job.approval) ||
        job.id !== a.request.requestId ||
        digest(evidence) !== job.data.evidenceDigest ||
        digest(coordinatorPrompt(a, evidence)) !== job.data.promptDigest ||
        launch.startedAt < a.approvedAt ||
        launch.startedAt >= a.expiresAt ||
        launch.launchDeadline <= launch.startedAt ||
        launch.launchDeadline > a.expiresAt ||
        launch.launchDeadline > launch.startedAt + 5000 ||
        launch.completionDeadline !== launch.startedAt + 60000
      )
        throw Error();
      const admission = {
        origin: "coordinator",
        requestId: job.id,
        issueId: a.issueId,
        approvalDigest: job.approvalDigest,
        runId: job.data.runId,
        sessionId: job.data.sessionId,
        evidence,
        promptDigest: job.data.promptDigest,
        evidenceDigest: job.data.evidenceDigest,
        launch,
      };
      if (e.expiresAt <= d.now()) throw Error();
      if (e.stage === "admission") {
        if (
          job.state !== "running" ||
          job.data.result !== undefined ||
          job.data.completion !== undefined ||
          d.now() >= launch.launchDeadline
        )
          throw Error();
        if (row.coordinator_state === "approved")
          row =
            (await d.store.admit(row, admission)) ??
            (await d.store.read(row.organization_id, row.request_id)!);
        if (
          !row ||
          row.coordinator_state !== "running" ||
          digest(row.coordinator_admission) !== digest(admission)
        )
          throw Error();
        return { status: "admitted" as const };
      }
      if (
        job.state !== "ready" ||
        !job.data.completion ||
        !job.data.result ||
        digest(row.coordinator_admission) !== digest(admission)
      )
        throw Error();
      const receipt = job.data.completion.receipt;
      if (
        receipt.requestId !== job.id ||
        receipt.issueId !== a.issueId ||
        receipt.runId !== job.data.runId ||
        receipt.sessionId !== job.data.sessionId ||
        job.data.completion.completedAt < launch.startedAt ||
        job.data.completion.completedAt >= launch.completionDeadline
      )
        throw Error();
      const brief = validateBrief(JSON.stringify(job.data.result), a, evidence);
      if (digest(brief) !== job.data.resultDigest) throw Error();
      if (row.coordinator_state === "running")
        row =
          (await d.store.accept(row, brief)) ??
          (await d.store.read(row.organization_id, row.request_id)!);
      if (
        !row ||
        row.coordinator_state !== "ready" ||
        row.coordinator_result_digest !== digest(brief) ||
        digest(row.coordinator_brief) !== digest(brief)
      )
        throw Error();
      return { status: "accepted" as const };
    } catch {
      throw Error("coordinator_receipt_rejected");
    }
  };
}
