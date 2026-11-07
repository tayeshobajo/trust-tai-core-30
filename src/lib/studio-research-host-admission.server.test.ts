import { it, expect, vi } from 'vitest';
import { generateKeyPairSync, randomUUID, createHash, sign } from 'node:crypto';
import { makeHostAdmittedRoutePlugin, type HostAdmission } from '../../packages/studio-research-coordinator/src/host-admitted-routes';
import { COORDINATOR, digest } from './studio-research-coordinator-contracts';
async function fixture() {
 const studio=generateKeyPairSync('ed25519'), hostKey=generateKeyPairSync('ed25519');
 const e={domain:'studio-coordinator-route/v1',sender:'studio',...COORDINATOR,subjectId:randomUUID(),requestId:randomUUID(),issueId:randomUUID(),approvalDigest:digest('approval'),operation:'run',nonce:randomUUID(),issuedAt:1000,expiresAt:31000,payload:{grant:'synthetic'}};
 // Contract constants also include runtime properties; build only signed-route schema fields.
 const envelope={domain:e.domain,sender:e.sender,companyId:e.companyId,projectId:e.projectId,agentId:e.agentId,organizationId:e.organizationId,subjectId:e.subjectId,requestId:e.requestId,issueId:e.issueId,approvalDigest:e.approvalDigest,operation:e.operation,nonce:e.nonce,issuedAt:e.issuedAt,expiresAt:e.expiresAt,payload:e.payload};
 const bytes=Buffer.from(JSON.stringify(envelope));const body={token:bytes.toString('base64url')+'.'+sign(null,bytes,studio.privateKey).toString('base64url')};
 const a:HostAdmission={version:1,admissionId:randomUUID(),pluginKey:'trusttai.studio-research-coordinator',companyId:e.companyId,projectId:e.projectId,agentId:e.agentId,requestId:e.requestId,issueId:e.issueId,operation:'run',bodyDigest:createHash('sha256').update(JSON.stringify(body)).digest('hex'),expiresAt:61000};
 const dispatch=vi.fn(async()=>({ready:true})), revalidate=vi.fn(async(_a:HostAdmission):Promise<unknown>=>a), claim=vi.fn(async()=>({claimed:true,response:null})), authorizeCurrent=vi.fn(async()=>{});
 const plugin=makeHostAdmittedRoutePlugin({peerKey:studio.publicKey,privateKey:hostKey.privateKey,now:()=>1000,ledger:{claim,finish:async()=>{}},authorizeCurrent,dispatch});
 await plugin.definition.setup({studioResearch:{revalidate}} as unknown as Parameters<typeof plugin.definition.setup>[0]);
 const input={studioAdmission:a,companyId:e.companyId,method:'POST',path:`/issues/${e.issueId}/research/${e.requestId}/run`,routeKey:'signed-run',params:{issueId:e.issueId,requestId:e.requestId},query:{},headers:{},body,actor:{actorType:'agent' as const,actorId:e.agentId}};
 return {plugin,input,dispatch,revalidate,claim,authorizeCurrent};
}
it('signed route uses host admission without forwarding bearer and rechecks after claim',async()=>{const f=await fixture();expect((await f.plugin.definition.onApiRequest!(f.input)).status).toBe(200);expect(f.revalidate).toHaveBeenCalledTimes(3);expect(f.dispatch).toHaveBeenCalledOnce();});
it('rejects key revocation during async nonce claim before dispatch',async()=>{const f=await fixture();f.claim.mockImplementationOnce(async()=>{f.revalidate.mockRejectedValue(Error('revoked'));return {claimed:true,response:null}});expect((await f.plugin.definition.onApiRequest!(f.input)).status).toBe(403);expect(f.dispatch).not.toHaveBeenCalled();});
it('rejects fake host result, body tampering and admission absent even with auth header',async()=>{const f=await fixture();f.revalidate.mockResolvedValue({...f.input.studioAdmission,issueId:randomUUID()});expect((await f.plugin.definition.onApiRequest!(f.input)).status).toBe(403);expect((await f.plugin.definition.onApiRequest!({...f.input,body:{token:'tampered'}})).status).toBe(403);expect((await f.plugin.definition.onApiRequest!({...f.input,studioAdmission:undefined,headers:{authorization:'Bearer fake'}} as unknown as typeof f.input)).status).toBe(403);expect(f.dispatch).not.toHaveBeenCalled();});
it('default and stock SDK remain unavailable',async()=>{const f=await fixture();expect((await makeHostAdmittedRoutePlugin().definition.onApiRequest!(f.input)).status).toBe(503);});
