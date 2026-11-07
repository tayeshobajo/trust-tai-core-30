/** Concrete operation mapping; server composition only. No router registration or ambient credentials. */
import { sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import {
  approvalSchema,
  digest,
  COORDINATOR,
  type Approval,
} from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import type { RouteEnvelope } from "./studio-research-route-transport.server";
import type { createStudioCoordinatorHandlers } from "./studio-research-coordinator-studio.server";
import type { createManualResearchComposition } from "./studio-research-composition.server";
import type { CoordinatorRequestStore } from "./studio-research-coordinator-request-store.server";
function bind(e: RouteEnvelope, a: Approval) {
  if (
    e.subjectId !== a.approvedBy ||
    e.requestId !== a.request.requestId ||
    e.issueId !== a.issueId ||
    e.approvalDigest !== digest(a)
  )
    throw Error("operation_binding_invalid");
}
export function makeStudioReceiptOperations(d: {
  handlers: ReturnType<typeof createStudioCoordinatorHandlers>;
  store: CoordinatorRequestStore;
  hostKey: KeyObject;
  studioKey: KeyObject;
  now(): number;
  /** Must query current active membership and Studio work access using Studio service storage. */
  currentMember(subject: string, organization: string): Promise<void>;
}) {
  return async (e: RouteEnvelope) => {
    const row = await d.store.read(e.organizationId, e.requestId);
    if (!row || row.created_by !== e.subjectId) throw Error("request_not_owned");
    const a = approvalSchema.parse(row.coordinator_approval);
    bind(e, a);
    await d.currentMember(e.subjectId, e.organizationId);
    if (d.now() >= e.expiresAt || e.issuedAt > d.now()) throw Error("operation_expired");
    if (e.operation === "authority")
      return {
        approval: a,
        state: row.coordinator_state,
        revoked: row.coordinator_state === "cancelled",
        admission: row.coordinator_admission,
        resultDigest: row.coordinator_result_digest,
      };
    if (e.operation !== "admission" && e.operation !== "result") throw Error("operation_invalid");
    const p = z
      .object({ receipt: z.string().max(190000) })
      .strict()
      .parse(e.payload);
    const receipt = z
      .object({
        stage: z.literal(e.operation),
        job: z
          .object({
            id: z.string(),
            approval: approvalSchema,
            approvalDigest: z.string(),
            data: z.object({ runId: z.string().uuid(), sessionId: z.string() }).passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(verifySignedJson(d.hostKey, p.receipt));
    bind(e, receipt.job.approval);
    if (receipt.job.id !== e.requestId || receipt.job.approvalDigest !== e.approvalDigest)
      throw Error("receipt_binding_invalid");
    await d.handlers.receive(p.receipt);
    const now = d.now();
    if (now >= e.expiresAt) throw Error("operation_expired");
    const payload = {
      domain: e.operation === "admission" ? "studio-admission-ack/v1" : "studio-result-ack/v1",
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      subjectId: e.subjectId,
      requestId: e.requestId,
      runId: receipt.job.data.runId,
      sessionId: receipt.job.data.sessionId,
      approvalDigest: e.approvalDigest,
      payloadDigest: digest(p.receipt),
      issuedAt: now,
      expiresAt: now + 30000,
      status: "accepted",
    };
    if (d.studioKey.type !== "private" || d.studioKey.asymmetricKeyType !== "ed25519")
      throw Error("signer_invalid");
    const b = Buffer.from(JSON.stringify(payload));
    return {
      ack: b.toString("base64url") + "." + sign(null, b, d.studioKey).toString("base64url"),
    };
  };
}
type Composition = Extract<
  Awaited<ReturnType<typeof createManualResearchComposition>>,
  { available: true }
>;
/** Verified signed server principal is not a fabricated browser session. Use this authorizer only for this boundary. */
export function createRoutePrincipalRegistry(now = Date.now) {
  const known = new WeakMap<Request, RouteEnvelope>();
  return {
    request(e: RouteEnvelope) {
      const r = new Request("https://coordinator.internal/verified-command", { method: "POST" });
      known.set(r, e);
      return r;
    },
    async authorize(r: Request, org: string) {
      const e = known.get(r);
      if (!e || e.organizationId !== org || e.sender !== "studio" || e.expiresAt <= now())
        throw Error("principal_unverified");
      return { userId: e.subjectId };
    },
  };
}
export function makeCoordinatorOperations(d: {
  composition: Composition;
  principals: ReturnType<typeof createRoutePrincipalRegistry>;
  loadApproval(id: string): Promise<Approval | null>;
}) {
  return async (e: RouteEnvelope) => {
    if (e.sender !== "studio") throw Error("sender_invalid");
    const a = await d.loadApproval(e.requestId);
    if (!a) throw Error("approval_missing");
    bind(e, a);
    const request = d.principals.request(e);
    switch (e.operation) {
      case "run": {
        const p = z
          .object({ approval: approvalSchema, grant: z.string().max(200000) })
          .strict()
          .parse(e.payload);
        if (digest(p.approval) !== digest(a)) throw Error("approval_mismatch");
        return d.composition.run(request, p);
      }
      case "read":
        return d.composition.read(request, e.requestId);
      case "cancel":
        return d.composition.cancel(request, e.requestId);
      case "reconcile":
        return d.composition.reconcileResult(request, e.requestId);
      case "review":
        return d.composition.review(
          request,
          e.requestId,
          z
            .object({
              decision: z.enum(["use", "edit", "save", "skip"]),
              editedText: z.string().max(5000).optional(),
            })
            .strict()
            .parse(e.payload),
        );
      default:
        throw Error("operation_invalid");
    }
  };
}
