import { z } from "zod";
import { COORDINATOR, digest, type Approval } from "./studio-research-coordinator-contracts";
import { STUDIO_TRIAL_REQUEST_ID, STUDIO_TRIAL_SOURCE } from "@/domain/studio-research-trial";
export const TRIAL_POLICY = {
  version: 1,
  requestId: STUDIO_TRIAL_REQUEST_ID,
  source: STUDIO_TRIAL_SOURCE,
  organizationId: COORDINATOR.organizationId,
  companyId: COORDINATOR.companyId,
  projectId: COORDINATOR.projectId,
  agentId: COORDINATOR.agentId,
  launches: 1,
  retries: 0,
  maxWindowMs: 3600000,
  consumption: "durable-before-dispatch-no-reset",
} as const;
export const TRIAL_POLICY_SHA256 = digest(TRIAL_POLICY);
export const trialConfigSchema = z
  .object({
    policyDigest: z.literal(TRIAL_POLICY_SHA256),
    requestId: z.literal(STUDIO_TRIAL_REQUEST_ID),
    subjectId: z.string().uuid(),
    source: z.literal(STUDIO_TRIAL_SOURCE),
    notBefore: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .refine(
    (t) => t.expiresAt > t.notBefore && t.expiresAt - t.notBefore <= TRIAL_POLICY.maxWindowMs,
  );
export type TrialConfig = z.infer<typeof trialConfigSchema>;
export function assertTrialScope(t: TrialConfig, subject: string, org: string, id?: string) {
  trialConfigSchema.parse(t);
  if (
    subject !== t.subjectId ||
    org !== COORDINATOR.organizationId ||
    (id !== undefined && id !== t.requestId)
  )
    throw Error("trial_scope_rejected");
}
export function assertTrialWindow(t: TrialConfig, now: number) {
  if (!Number.isFinite(now) || now < t.notBefore || now >= t.expiresAt)
    throw Error("trial_expired");
}
export function assertTrialApproval(t: TrialConfig, a: Approval) {
  assertTrialScope(t, a.approvedBy, a.request.organizationId, a.request.requestId);
  if (
    a.companyId !== COORDINATOR.companyId ||
    a.projectId !== COORDINATOR.projectId ||
    a.agentId !== COORDINATOR.agentId ||
    a.approvedUrls.length !== 1 ||
    a.approvedUrls[0] !== t.source
  )
    throw Error("trial_approval_rejected");
}
