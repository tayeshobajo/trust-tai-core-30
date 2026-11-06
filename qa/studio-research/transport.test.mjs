import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioTransport } from '../../src/lib/studio-research-transport.server.mjs';
const config = { origin:'https://agents.trusttai.com', key:'fixture-only', companyId:'11111111-1111-4111-8111-111111111111', projectId:'22222222-2222-4222-8222-222222222222', agentId:'5cbc9418-0ff9-4f1c-a807-c0632e26a538' };
const issue = {id:'33333333-3333-4333-8333-333333333333',companyId:config.companyId,projectId:config.projectId,assigneeAgentId:config.agentId,status:'done'};
const input = {companyId:config.companyId,assigneeAgentId:config.agentId,title:'Research public sources',description:'Fixture only',correlationId:'fixture-request'};
const json = x => new Response(JSON.stringify(x), {headers:{'content-type':'application/json'}});
const identity = {id:config.agentId,companyId:config.companyId,status:'paused',keyScope:{kind:'task_bridge',projectId:config.projectId,allowedAssigneeAgentIds:[config.agentId]}};
test('reads scoped self identity and preserves paused status', async () => {
  const client=createStudioTransport(config,async url=>{assert.equal(url,`${config.origin}/api/agents/me`);return json(identity);});
  assert.deepEqual(await client.readAgent(config.agentId),{id:config.agentId,companyId:config.companyId,status:'paused'});
});
test('rejects standard credentials and additional project or parent boundaries', async () => {
  for(const keyScope of [{kind:'standard'},{...identity.keyScope,projectIds:[issue.id]},{...identity.keyScope,parentIssueId:issue.id}]){
    const client=createStudioTransport(config,async()=>json({...identity,keyScope}));
    await assert.rejects(client.readAgent(config.agentId));
  }
});
test('rejects changed credential recipient and incomplete scope before any network call', () => {
  assert.throws(()=>createStudioTransport({...config,origin:'https://example.org'}));
  assert.throws(()=>createStudioTransport({...config,projectId:''}));
});
test('submits exactly one bound task and prohibits credential redirects', async () => {
  let calls=0;
  const client=createStudioTransport(config,async (url, init)=>{ calls++; assert.equal(url,`${config.origin}/api/companies/${config.companyId}/issues`); assert.equal(init.redirect,'error'); const body=JSON.parse(init.body); assert.equal(body.projectId,config.projectId); assert.equal(body.assigneeAgentId,config.agentId); return json(issue); });
  await client.createIssue(input); assert.equal(calls,1);
});
test('never retries ambiguous task submission', async () => {
  let calls=0; const client=createStudioTransport(config,async ()=>{calls++;throw new Error('response lost');});
  await assert.rejects(client.createIssue(input)); assert.equal(calls,1);
});
test('rejects wrong project before reading comments', async () => {
  let calls=0; const client=createStudioTransport(config,async ()=>{calls++;return json({...issue,projectId:'44444444-4444-4444-8444-444444444444'});});
  await assert.rejects(client.readIssue(config.companyId,issue.id)); assert.equal(calls,1);
});
test('retrieves only bound issue/comments and rejects foreign comment provenance', async () => {
  let calls=0; const client=createStudioTransport(config,async ()=>++calls===1?json(issue):json([{id:issue.id,companyId:config.companyId,issueId:'44444444-4444-4444-8444-444444444444',body:'wrong task'}]));
  await assert.rejects(client.readIssue(config.companyId,issue.id));
});
test('rejects an oversized comment collection instead of accepting partial results', async () => {
  let calls=0; const client=createStudioTransport(config,async ()=>++calls===1?json(issue):json(Array(101).fill({})));
  await assert.rejects(client.readIssue(config.companyId,issue.id));
});
