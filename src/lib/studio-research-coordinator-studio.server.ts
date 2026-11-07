import { cliAccountingSchema, type CliAccounting } from "./studio-research-coordinator-contracts";
/** Staged Studio-side route handlers: not registered in router/startup, no env secret loading. */
import { sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import { authorizeStudioResearch } from "./studio-research-access.server";
import {
  COORDINATOR,
  PROMPT_POLICY_SHA256,
  COMPOSITION_POLICY_SHA256,
  LINUX_PREVIEW_POLICY_SHA256,
  approvalSchema,
  checkApproval,
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
import type { Job } from "./studio-research-coordinator-store.server";
const ids = z
  .object({ organizationId: z.literal(COORDINATOR.organizationId), requestId: z.string().uuid() })
  .strict();
const command = ids.extend({ approvedUrls: z.array(z.string().url()).min(1).max(3) }).strict();
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
function signed(key: KeyObject, payload: unknown) {
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519")
    throw Error("signer_unavailable");
  const b = Buffer.from(JSON.stringify(payload));
  return b.toString("base64url") + "." + sign(null, b, key).toString("base64url");
}
export { signCoordinatorReceipt } from "./studio-research-receipt-signing.server";

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
/** Keys and enabled switch are trusted server configuration; never route inputs.
 * Authentication defaults to existing getUser/membership/app-access checks, mocked offline in tests. */
export function createStudioCoordinatorHandlers(
  options: {
    store: CoordinatorRequestStore;
    enabled: boolean;
    executionMode?: "offline-synthetic" | "linux-public-preview";
    approvalPrivateKey?: KeyObject;
    receiptPublicKey?: KeyObject;
    now(): number;
  },
  authenticate: typeof authorizeStudioResearch = authorizeStudioResearch,
) {
  const d = options;
  function enabled() {
    if (!d.enabled) throw Error("coordinator_disabled");
  }
  async function owned(request: Request, raw: unknown, work: boolean) {
    const i = ids.parse(raw);
    const auth = await authenticate(request, i.organizationId, work);
    const row = await d.store.read(i.organizationId, i.requestId);
    if (
      !row ||
      row.created_by !== auth.user.id ||
      row.organization_id !== i.organizationId ||
      row.request_id !== i.requestId
    )
      throw Error("request_not_owned");
    return row;
  }
  return {
    async approve(request: Request, raw: unknown) {
      enabled();
      if (request.method !== "POST" || !d.approvalPrivateKey) throw Error("approval_unavailable");
      const c = command.parse(raw);
      let row = await owned(
        request,
        { organizationId: c.organizationId, requestId: c.requestId },
        true,
      );
      if (row.coordinator_state === null) {
        const now = d.now();
        const a = checkApproval(
          {
            version: 1,
            promptPolicySha256: PROMPT_POLICY_SHA256,
            executionPolicySha256: d.executionMode === "linux-public-preview" ? LINUX_PREVIEW_POLICY_SHA256 : COMPOSITION_POLICY_SHA256,
            request: {
              organizationId: row.organization_id,
              requestId: row.request_id,
              topic: row.topic,
            },
            approvedBy: row.created_by,
            issueId: row.issue_id,
            companyId: COORDINATOR.companyId,
            projectId: COORDINATOR.projectId,
            agentId: COORDINATOR.agentId,
            primaryModel: COORDINATOR.model,
            auxiliaryModel: COORDINATOR.model,
            endpoint: COORDINATOR.endpoint,
            nativeTools: "deny",
            maxProviderRequests: null,
            maxCliJobs: 1,
            timeoutMs: 60000,
            draftRequested: false,
            voiceExamples: [],
            approvedUrls: c.approvedUrls,
            approvedAt: now,
            expiresAt: now + 300000,
          },
          now,
        );
        if (!bound(row, a)) throw Error("binding_invalid");
        row =
          (await d.store.approve(row, a)) ??
          (await owned(
            request,
            { organizationId: c.organizationId, requestId: c.requestId },
            true,
          ));
      }
      const a = storedApproval(row);
      if (
        row.coordinator_state !== "approved" ||
        JSON.stringify(a.approvedUrls) !== JSON.stringify(c.approvedUrls)
      )
        throw Error("approval_conflict");
      // Revalidate real user access after the durable write; delayed or revoked access cannot mint authority.
      const fresh = await owned(
        request,
        { organizationId: c.organizationId, requestId: c.requestId },
        true,
      );
      if (fresh.coordinator_state !== "approved" || fresh.coordinator_approval_digest !== digest(a))
        throw Error("approval_conflict");
      checkApproval(a, d.now());
      const issuedAt = d.now(),
        expiresAt = Math.min(a.expiresAt, issuedAt + 60000);
      return {
        approval: a,
        attestation: signed(d.approvalPrivateKey, {
          version: 1,
          issuer: "studio-approved-task",
          audience: "studio-research-coordinator",
          subjectId: a.approvedBy,
          organizationId: a.request.organizationId,
          companyId: a.companyId,
          agentId: a.agentId,
          projectId: a.projectId,
          requestId: a.request.requestId,
          issueId: a.issueId,
          approvalDigest: digest(a),
          issuedAt,
          expiresAt,
          actions: ["approve", "run", "read", "cancel", "review"],
        }),
      };
    },
    async receive(token: unknown) {
      enabled();
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
    },
    async read(request: Request, raw: unknown) {
      const row = await owned(request, raw, false);
      if (row.coordinator_state !== "ready")
        return {
          origin: "coordinator" as const,
          status:
            row.coordinator_state === "cancelled"
              ? ("result_acceptance_blocked" as const)
              : ("coordinator_waiting" as const),
          phase: row.coordinator_state ?? "unprepared",
        };
      const a = storedApproval(row);
      const admission = row.coordinator_admission as { evidence: SourceEvidence[] };
      const brief = validateBrief(JSON.stringify(row.coordinator_brief), a, admission.evidence);
      if (digest(brief) !== row.coordinator_result_digest) throw Error("stored_result_invalid");
      return {
        origin: "coordinator" as const,
        status: "review_ready" as const,
        result: brief.research,
        people: brief.people,
        draft: brief.draft,
      };
    },
    async cancel(request: Request, raw: unknown) {
      enabled();
      if (request.method !== "POST") throw Error("method_invalid");
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await owned(request, raw, true);
        if (!["approved", "running"].includes(row.coordinator_state ?? ""))
          return {
            status:
              row.coordinator_state === "cancelled"
                ? "result_acceptance_blocked"
                : row.coordinator_state,
            executionStop: "unverified",
          };
        if (await d.store.cancel(row))
          return { status: "result_acceptance_blocked", executionStop: "unverified" };
      }
      throw Error("cancellation_conflict");
    },
  };
}
