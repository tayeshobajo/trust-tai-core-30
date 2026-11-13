import { expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { recoverReservedIntake,RECOVERY_SUBJECT,RECOVERY_TOPIC,RECOVERY_BRIDGE_ID } from "./studio-research-intake-recovery.server";
import { createCoordinatorRequestStore,type CoordinatorRow } from "./studio-research-coordinator-request-store.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
import { STUDIO_TRIAL_REQUEST_ID } from "@/domain/studio-research-trial";
function fixture(){
 const input={organizationId:COORDINATOR.organizationId,requestId:STUDIO_TRIAL_REQUEST_ID,topic:RECOVERY_TOPIC};
 let row:CoordinatorRow={id:randomUUID(),organization_id:input.organizationId,request_id:input.requestId,created_by:RECOVERY_SUBJECT,topic:input.topic,company_id:COORDINATOR.companyId,agent_id:COORDINATOR.agentId,state:"dispatch_uncertain",issue_id:null,result:null,result_comment_id:null,coordinator_state:null,coordinator_approval:null,coordinator_approval_digest:null,coordinator_admission:null,coordinator_brief:null,coordinator_result_digest:null,intake_recovery_receipt:null,intake_recovery_authorization:{version:1,kind:"owner-approved-single-intake-recovery",requestId:input.requestId,subjectId:RECOVERY_SUBJECT,bridgeKeyId:RECOVERY_BRIDGE_ID,topic:input.topic,duplicateCheck:"no-matching-issue-or-execution-observed",checkedAt:9000,expiresAt:120000}};
 const writes:URLSearchParams[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   const p=new URL(String(url)).searchParams;
   if(init?.method==="PATCH"){
     writes.push(p);
     for(const [k,v] of p){
       if(k==="limit")continue;
       const value=(row as Record<string,unknown>)[k];
       if(v==="is.null" ? value!=null : v!==`eq.${typeof value==='object'?JSON.stringify(value):value}`)
         return Response.json([]);
     }
     row={...row,...JSON.parse(String(init.body))};
   }
   return Response.json([row]);
 });
 const store=createCoordinatorRequestStore("fixture",fetcher,"https://okydosoacqdnursmmenf.supabase.co");
 const issueId=randomUUID();
 const bridge={createIssue:vi.fn(async()=>({id:issueId,companyId:COORDINATOR.companyId,projectId:COORDINATOR.projectId,assigneeAgentId:null,originKind:"task_bridge",originId:RECOVERY_BRIDGE_ID,createdByAgentId:COORDINATOR.agentId})),readIssue:vi.fn(async()=>({})),readAgent:vi.fn(async()=>({status:"paused"}))} as any;
 const d={store,bridge,authorize:vi.fn(async()=>RECOVERY_SUBJECT),now:()=>10000,active:vi.fn()};
 return {input,d,writes,get row(){return row},set row(r:CoordinatorRow){row=r}};
}
it("claims one recovery atomically, preserving uncertainty until verified attachment",async()=>{
 const f=fixture();
 const results=await Promise.all([recoverReservedIntake(f.input,f.d),recoverReservedIntake(f.input,f.d)]);
 expect(results.some(r=>r.status==='prepared')).toBe(true);
 expect(f.d.bridge.createIssue).toHaveBeenCalledTimes(1);
 expect(f.d.bridge.readIssue).toHaveBeenCalledTimes(1);
 expect(f.row.state).toBe('submitted');
 expect(f.row.intake_recovery_receipt).toMatchObject({stage:'attached',issueId:f.row.issue_id});
 expect(f.writes[0]!.get('state')).toBe('eq.dispatch_uncertain');
 expect(f.writes[0]!.get('intake_recovery_receipt')).toBe('is.null');
 expect(f.writes[0]!.get('coordinator_admission')).toBe('is.null');
});
it.each(['HTTP409','network loss','provenance mismatch'])("never retries recovery after %s",async(message)=>{
 const f=fixture();
 f.d.bridge.createIssue.mockRejectedValueOnce(Error(message));
 expect((await recoverReservedIntake(f.input,f.d)).status).toBe('uncertain');
 expect((await recoverReservedIntake(f.input,f.d)).status).toBe('uncertain');
 expect(f.row.state).toBe('dispatch_uncertain');expect(f.row.issue_id).toBeNull();
 expect(f.row.intake_recovery_receipt).toMatchObject({stage:'claimed'});
 expect(f.d.bridge.createIssue).toHaveBeenCalledTimes(1);
});
it("rejects expired duplicate evidence, foreign owner, changed content and prior admission",async()=>{
 for(const mode of ['expired','owner','topic','admission']){
  const f=fixture();
  if(mode==='expired')f.d.now=()=>130000;
  if(mode==='owner')f.d.authorize=vi.fn(async()=>randomUUID());
  if(mode==='topic')f.input.topic='changed';
  if(mode==='admission')f.row={...f.row,coordinator_admission:{run:'prior'}};
  await recoverReservedIntake(f.input,f.d).catch(()=>undefined);
  expect(f.d.bridge.createIssue).not.toHaveBeenCalled();
 }
});
it("does not attach when readback verification fails",async()=>{
 const f=fixture();f.d.bridge.readIssue.mockRejectedValueOnce(Error('wrong origin'));
 expect((await recoverReservedIntake(f.input,f.d)).status).toBe('uncertain');
 expect(f.row.issue_id).toBeNull();expect(f.row.state).toBe('dispatch_uncertain');
});

it("reconciles only the known created issue without another create POST",async()=>{
 const f=fixture();f.d.bridge.createIssue.mockRejectedValueOnce(Error("lost response"));
 await recoverReservedIntake(f.input,f.d);
 f.d.now=()=>45000;
 f.d.bridge.readIssue.mockResolvedValue({id:"a0344163-409e-42c2-982c-b942ef1c7596"});
 expect((await recoverReservedIntake(f.input,f.d)).status).toBe("prepared");
 expect(f.d.bridge.createIssue).toHaveBeenCalledTimes(1);
 expect(f.row.issue_id).toBe("a0344163-409e-42c2-982c-b942ef1c7596");
});
