/** Authenticated result receiver candidate. No production storage transport is connected. */
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import {
  COORDINATOR,
  approvalSchema,
  coordinatorPrompt,
  digest,
  validateBrief,
  type Brief,
} from "./studio-research-coordinator-contracts";
import type { Job } from "./studio-research-coordinator-store.server";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
const envelopeSchema = z
  .object({
    version: z.literal(1),
    issuer: z.literal("studio-research-result"),
    audience: z.literal("studio-result-store"),
    organizationId: z.literal(COORDINATOR.organizationId),
    companyId: z.literal(COORDINATOR.companyId),
    agentId: z.literal(COORDINATOR.agentId),
    projectId: z.literal(COORDINATOR.projectId),
    requestId: z.string().uuid(),
    issueId: z.string().uuid(),
    runId: z.string().uuid(),
    sessionId: z.string(),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    promptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().finite(),
    expiresAt: z.number().finite(),
    result: z.unknown(),
  })
  .strict();
export type RelayBinding = {
  organizationId: string;
  requestId: string;
  issueId: string;
  runId: string;
  approvalDigest: string;
  resultDigest: string;
};
export function createResultRelay(d: {
  publicKey: KeyObject;
  now(): number;
  /** Independent server ledger, never values from the signed payload alone. */
  readApprovedJob(organizationId: string, requestId: string): Promise<Job | null>;
  /** Atomic compare-and-set against an existing exact record; never insert/upsert or overwrite. */
  accept(binding: RelayBinding, result: Brief): Promise<"accepted" | "same" | "conflict">;
}) {
  return async (token: unknown) => {
    try {
      const e = envelopeSchema.parse(verifySignedJson(d.publicKey, token));
      const job = await d.readApprovedJob(e.organizationId, e.requestId);
      const now = d.now();
      if (
        !job ||
        !["ready", "reviewed"].includes(job.state) ||
        e.issuedAt > now ||
        e.expiresAt <= now ||
        e.expiresAt <= e.issuedAt ||
        e.expiresAt - e.issuedAt > 60000
      )
        throw Error();
      const a = approvalSchema.parse(job.approval),
        evidence = job.data.evidence;
      if (
        !evidence ||
        !job.data.result ||
        a.request.organizationId !== e.organizationId ||
        a.request.requestId !== e.requestId ||
        job.id !== e.requestId ||
        a.issueId !== e.issueId ||
        job.data.runId !== e.runId ||
        job.data.sessionId !== e.sessionId ||
        digest(a) !== e.approvalDigest ||
        job.approvalDigest !== e.approvalDigest ||
        digest(evidence) !== e.evidenceDigest ||
        job.data.evidenceDigest !== e.evidenceDigest ||
        digest(coordinatorPrompt(a, evidence)) !== e.promptDigest ||
        job.data.promptDigest !== e.promptDigest ||
        digest(e.result) !== e.resultDigest ||
        job.data.resultDigest !== e.resultDigest ||
        digest(job.data.result) !== e.resultDigest
      )
        throw Error();
      const result = validateBrief(JSON.stringify(e.result), a, evidence);
      const outcome = await d.accept(
        {
          organizationId: e.organizationId,
          requestId: e.requestId,
          issueId: e.issueId,
          runId: e.runId,
          approvalDigest: e.approvalDigest,
          resultDigest: e.resultDigest,
        },
        result,
      );
      if (outcome !== "accepted" && outcome !== "same") throw Error();
      return { status: outcome };
    } catch {
      throw Error("result_rejected");
    }
  };
}
/** Existing store requires an authenticated native-agent comment ID; no such receipt exists here.
 * Do not invent comment provenance or relax that schema to wire this candidate. */
export async function unavailableProductionResultWriter(): Promise<never> {
  throw Error("coordinator_result_storage_unavailable");
}
