import { z } from "zod";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
import { researchIssueDescription, researchRequestSchema } from "@/domain/studio-research";
import { createPausedStudioIntakeTransport, studioTransportDiagnostic } from "./studio-research-transport.server.mjs";
import type { CoordinatorRequestStore, CoordinatorRow } from "./studio-research-coordinator-request-store.server";
import { STUDIO_TRIAL_REQUEST_ID } from "@/domain/studio-research-trial";
export const RECOVERY_BRIDGE_ID = "16e5e884-7ffb-480f-a0ed-c52ae131eaa1";
export const RECOVERY_SUBJECT = "e1b3c843-3a91-4c27-a291-9e6ced782b9f";
export const RECOVERY_TOPIC = "Explain IANA's example domains, their intended use, and limitations, citing only the approved IANA page.";
const authorization = z.object({version:z.literal(1),kind:z.literal("owner-approved-single-intake-recovery"),requestId:z.literal(STUDIO_TRIAL_REQUEST_ID),subjectId:z.literal(RECOVERY_SUBJECT),bridgeKeyId:z.literal(RECOVERY_BRIDGE_ID),topic:z.literal(RECOVERY_TOPIC),duplicateCheck:z.literal("no-matching-issue-or-execution-observed"),checkedAt:z.number().int(),expiresAt:z.number().int()}).strict();
export function recoveryTransport(key: string, fetcher: typeof fetch) {
  const request={organizationId:COORDINATOR.organizationId,requestId:STUDIO_TRIAL_REQUEST_ID,topic:RECOVERY_TOPIC};
  return createPausedStudioIntakeTransport({origin:"https://agents.trusttai.com",key,companyId:COORDINATOR.companyId,projectId:COORDINATOR.projectId,agentId:COORDINATOR.agentId},
    {bridgeKeyId:RECOVERY_BRIDGE_ID,organizationId:request.organizationId,requestId:request.requestId,title:`Studio research: ${request.topic.slice(0,100)}`,description:researchIssueDescription(request)},fetcher);
}
export async function recoverReservedIntake(raw: unknown, d: {
  store: CoordinatorRequestStore; bridge: ReturnType<typeof recoveryTransport>;
  authorize(): Promise<string>; now(): number; active(): void;
}) {
  const input=researchRequestSchema.parse(raw);
  const uncertain={status:"uncertain" as const,requestId:input.requestId};
  const subject=await d.authorize();
  const row=await d.store.read(input.organizationId,input.requestId);
  if (!row || subject!==RECOVERY_SUBJECT || row.created_by!==subject || row.organization_id!==input.organizationId || row.request_id!==input.requestId || input.requestId!==STUDIO_TRIAL_REQUEST_ID || input.organizationId!==COORDINATOR.organizationId || input.topic!==RECOVERY_TOPIC || row.topic!==input.topic || row.company_id!==COORDINATOR.companyId || row.agent_id!==COORDINATOR.agentId) throw Error("recovery_not_owned");
  if(row.state!=="dispatch_uncertain" || row.issue_id || row.coordinator_state || row.coordinator_approval || row.coordinator_admission || row.result || row.result_comment_id) return uncertain;
  const a=authorization.parse(row.intake_recovery_authorization);
  const now=d.now();
  if(row.intake_recovery_receipt) {
    // Reconcile only the issue observed in Paperclip audit after this exact recovery.
    // This branch can never send another issue-create POST.
    const prior=row.intake_recovery_receipt as Record<string,unknown>;
    if(typeof prior["claimedAt"]!=="number" || now-prior["claimedAt"]<30000 || prior["stage"]!=="claimed" || prior["authorizationDigest"]!==digest(a) || prior["requestDigest"]!==digest(input))return uncertain;
    let phase="verify_existing_issue";
    try {
      d.active();
      const issueId="a0344163-409e-42c2-982c-b942ef1c7596";
      if((await d.bridge.readAgent(COORDINATOR.agentId)).status!=="paused")throw Error("native_agent_not_paused");
      const existing=await d.bridge.readIssue(COORDINATOR.companyId,issueId);
      if(existing.id!==issueId)throw Error("issue_mismatch");
      phase="attach_existing_issue";
      if(await d.authorize()!==subject)throw Error("authorization_changed");
      const attached=await d.store.attachIntakeRecovery(row,{...prior,stage:"attached",issueId,attachedAt:d.now(),reconciledExisting:true},issueId);
      if(!attached)throw Error("compare_and_swap_rejected");
      return {status:"prepared" as const,requestId:input.requestId,issueId};
    } catch(error) {
      await d.store.observeIntakeRecovery(row,{...prior,lastObservation:{phase,diagnostic:studioTransportDiagnostic(error),at:d.now()}}).catch(()=>undefined);
      return uncertain;
    }
  }
  if(a.checkedAt>now || a.expiresAt<=now || a.expiresAt-a.checkedAt>120000) throw Error("recovery_check_expired");
  d.active();
  const receipt={version:1,stage:"claimed",authorizationDigest:digest(a),requestDigest:digest(input),bridgeKeyId:RECOVERY_BRIDGE_ID,claimedAt:now};
  const claimed=await d.store.claimIntakeRecovery(row,receipt);
  if(!claimed)return uncertain;
  // A lost response after this point remains consumed, even if no issue exists.
  try {
    if(await d.authorize()!==subject)throw Error("authorization_changed");
    d.active();
    if(d.now()>=a.expiresAt)throw Error("recovery_check_expired");
    const issue=await d.bridge.createIssue({companyId:COORDINATOR.companyId,assigneeAgentId:COORDINATOR.agentId,title:`Studio research: ${input.topic.slice(0,100)}`,description:researchIssueDescription(input),correlationId:`studio:research:${input.organizationId}:${input.requestId}`});
    await d.bridge.readIssue(COORDINATOR.companyId,issue.id);
    if(await d.authorize()!==subject)throw Error("authorization_changed");
    const attached=await d.store.attachIntakeRecovery(claimed,{...receipt,stage:"attached",issueId:issue.id,attachedAt:d.now()},issue.id);
    return attached?{status:"prepared" as const,requestId:input.requestId,issueId:issue.id}:uncertain;
  } catch { return uncertain; }
}
export async function verifyRecoveredIssue(row: CoordinatorRow, bridge: ReturnType<typeof recoveryTransport>) {
  if(!row.intake_recovery_receipt)return;
  const r=row.intake_recovery_receipt as Record<string,unknown>;
  const a=authorization.parse(row.intake_recovery_authorization);
  if(r["authorizationDigest"]!==digest(a) || r["requestDigest"]!==digest({organizationId:row.organization_id,requestId:row.request_id,topic:row.topic}))throw Error("recovery_receipt_invalid");
  if(row.request_id!==STUDIO_TRIAL_REQUEST_ID || row.created_by!==RECOVERY_SUBJECT || row.topic!==RECOVERY_TOPIC || r["stage"]!=="attached" || r["issueId"]!==row.issue_id || r["bridgeKeyId"]!==RECOVERY_BRIDGE_ID || !row.issue_id)throw Error("recovery_binding_invalid");
  if((await bridge.readAgent(COORDINATOR.agentId)).status!=="paused")throw Error("native_agent_not_paused");
  await bridge.readIssue(COORDINATOR.companyId,row.issue_id);
}
