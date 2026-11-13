import { z } from "zod";
import { checkApproval,digest,type Approval } from "./studio-research-coordinator-contracts";
import { assertTrialApproval,assertTrialScope,assertTrialWindow,type TrialConfig } from "./studio-research-trial.server";
import type { CoordinatorRow } from "./studio-research-coordinator-request-store.server";
const renewalSchema=z.object({version:z.literal(1),kind:z.literal("owner-approved-unlaunched-renewal"),requestId:z.string().uuid(),subjectId:z.string().uuid(),issueId:z.string().uuid(),previousDigest:z.string().regex(/^[a-f0-9]{64}$/),executionEvidence:z.literal("no-host-job-or-trial-admission"),checkedAt:z.number().int(),expiresAt:z.number().int(),trialNotBefore:z.number().int(),trialExpiresAt:z.number().int()}).strict();
export function prepareApprovalRenewal(row:CoordinatorRow,prior:Approval,trial:TrialConfig,now:number){
 const a=renewalSchema.parse(row.coordinator_renewal_authorization);
 assertTrialScope(trial,row.created_by,row.organization_id,row.request_id);assertTrialWindow(trial,now);assertTrialApproval(trial,prior);
 if(row.coordinator_state!=="approved" || row.coordinator_admission || row.coordinator_brief || row.coordinator_result_digest || row.coordinator_renewal_receipt || (row.coordinator_approval_history??[]).length || prior.expiresAt>now || a.checkedAt>now || a.expiresAt<=now || a.expiresAt-a.checkedAt>120000 || a.requestId!==row.request_id || a.subjectId!==row.created_by || a.issueId!==row.issue_id || a.previousDigest!==row.coordinator_approval_digest || digest(prior)!==a.previousDigest || a.trialNotBefore!==trial.notBefore || a.trialExpiresAt!==trial.expiresAt)throw Error("approval_renewal_rejected");
 const approval=checkApproval({...prior,approvedAt:now,expiresAt:Math.min(now+300000,trial.expiresAt)},now);
 const receipt={version:1,kind:"unlaunched-approval-renewal",previousDigest:a.previousDigest,approvalDigest:digest(approval),authorizationDigest:digest(a),renewedAt:now};
 return {approval,receipt,history:[{approval:prior,approvalDigest:a.previousDigest,renewedAt:now}]};
}
