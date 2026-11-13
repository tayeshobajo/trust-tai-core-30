import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioTransport, createPausedStudioIntakeTransport, studioTransportDiagnostic } from '../../src/lib/studio-research-transport.server.mjs';
const config = { origin:'https://agents.trusttai.com', key:'fixture-only', companyId:'11111111-1111-4111-8111-111111111111', projectId:'22222222-2222-4222-8222-222222222222', agentId:'5cbc9418-0ff9-4f1c-a807-c0632e26a538' };
const issue = {id:'33333333-3333-4333-8333-333333333333',companyId:config.companyId,projectId:config.projectId,assigneeAgentId:config.agentId,status:'done'};
const input = {companyId:config.companyId,assigneeAgentId:config.agentId,title:'Research public sources',description:'Fixture only',correlationId:'fixture-request'};
const json = x => new Response(JSON.stringify(x), {headers:{'content-type':'application/json'}});
const binding={title:input.title,description:input.description,bridgeKeyId:'77777777-7777-4777-8777-777777777777',organizationId:'88888888-8888-4888-8888-888888888888',requestId:'99999999-9999-4999-8999-999999999999'};
const stagedInput={...input,correlationId:`studio:research:${binding.organizationId}:${binding.requestId}`};
const stagedIssue={...issue,title:input.title,assigneeAgentId:null,assigneeUserId:null,status:'backlog',originKind:'task_bridge',originId:binding.bridgeKeyId,createdByAgentId:config.agentId,createdByUserId:null,parentId:null,description:`${input.description}\n\nStudio correlation: ${stagedInput.correlationId}`};
const identity = {id:config.agentId,companyId:config.companyId,status:'paused',keyScope:{kind:'task_bridge',projectId:config.projectId,allowedAssigneeAgentIds:[config.agentId]}};
test('prepared staging verifies paused identity then creates unassigned backlog without wake parameters',async()=>{
  const calls=[];
  const client=createPausedStudioIntakeTransport(config,binding,async(url,init)=>{calls.push({url,init});return json(url.endsWith('/agents/me')?identity:stagedIssue)});
  const create=client.createIssue;
  assert.equal((await create(stagedInput)).id,issue.id);
  assert.equal(calls.length,2);
  const body=JSON.parse(calls[1].init.body);
  assert.equal(body.assigneeAgentId,null);assert.equal(body.assigneeUserId,null);
  assert.equal(body.parentId,null);assert.equal(body.status,'backlog');
  assert.equal(body.projectId,config.projectId);assert.equal(body.executionPolicy,undefined);
  assert.equal(body.watchdog,undefined);
});
test('staging rejects foreign correlation and non-paused identity before a POST',async()=>{
  let posts=0;
  const client=createPausedStudioIntakeTransport(config,binding,async(_url,init)=>{if(init.method==='POST')posts++;return json({...identity,status:'idle'})});
  await assert.rejects(client.createIssue(input));await assert.rejects(client.createIssue(stagedInput));assert.equal(posts,0);
});
test('staging rejects substituted provenance, assignment, execution and correlation before comments',async()=>{
  for(const change of [{originId:issue.id},{originKind:'manual'},{createdByAgentId:issue.id},{createdByUserId:issue.id},{assigneeAgentId:config.agentId},{assigneeUserId:issue.id},{projectId:issue.id},{companyId:issue.id},{status:'todo'},{parentId:issue.id},{checkoutRunId:issue.id},{executionRunId:issue.id},{watchdog:{}},{executionPolicy:{monitor:{}}},{deduplicated:true},{description:'wrong'},{title:'changed topic'},{description:`changed topic\n\nStudio correlation: ${stagedInput.correlationId}`}]){
    let calls=0;const client=createPausedStudioIntakeTransport(config,binding,async()=>{calls++;return json({...stagedIssue,...change})});
    await assert.rejects(client.readIssue(config.companyId,issue.id));assert.equal(calls,1);
  }
});
test('staging does not retry HTTP 409 or a lost response',async()=>{
  for(const lost of [false,true]){
    let posts=0;const client=createPausedStudioIntakeTransport(config,binding,async(url)=>{
      if(url.endsWith('/agents/me'))return json(identity);posts++;
      if(lost)throw Error('private lost response');return new Response('private conflict',{status:409});
    });
    await assert.rejects(client.createIssue(stagedInput),error=>{assert.equal(studioTransportDiagnostic(error),lost?'network_failure':'http_409');assert.equal(error.message,'Paperclip verification failed.');return true});
    assert.equal(posts,1);
  }
});
test('staging reads only the exact pinned issue and legacy transport still rejects unassigned issues',async()=>{
  let calls=0;
  const client=createPausedStudioIntakeTransport(config,binding,async()=>json(++calls===1?stagedIssue:[]));
  assert.equal((await client.readIssue(config.companyId,issue.id)).id,issue.id);
  assert.equal(calls,2);
  await assert.rejects(createStudioTransport(config,async()=>json(stagedIssue)).readIssue(config.companyId,issue.id));
  assert.throws(()=>createPausedStudioIntakeTransport(config,{...binding,bridgeKeyId:''}));
  assert.throws(()=>createPausedStudioIntakeTransport(config,{...binding,description:''}));
});
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
  const client=createStudioTransport(config,async (url, init)=>{ calls++; assert.equal(url,`${config.origin}/api/companies/${config.companyId}/issues`); assert.equal(init.redirect,'manual'); const body=JSON.parse(init.body); assert.equal(body.projectId,config.projectId); assert.equal(body.assigneeAgentId,config.agentId); return json(issue); });
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

test('reports bounded transport and identity categories without raw responses or secrets', async () => {
  const cases = [
    [async()=>{throw new Error('private response')}, 'network_failure'],
    [async()=>{throw new DOMException('private', 'TimeoutError')}, 'timeout'],
    ...[401,403,404,409,429].map(status=>[async()=>new Response('private body',{status}),`http_${status}`]),
    [async()=>new Response('private body',{status:503}),'http_server_error'],
    [async()=>new Response('private body',{status:418}),'http_client_error'],
    [async()=>new Response('private body'),'response_format'],
    [async()=>new Response('private body',{headers:{'content-type':'application/json'}}),'response_json'],
    [async()=>json({...identity,id:issue.id}),'identity_mismatch'],
    [async()=>json({...identity,keyScope:{kind:'standard'}}),'scope_mismatch'],
    [async()=>json({...identity,status:null}),'identity_shape'],
  ];
  for(const [fetcher, code] of cases) {
    let calls=0;
    const client=createStudioTransport(config,async(...args)=>{calls++;return fetcher(...args)});
    await assert.rejects(client.readAgent(config.agentId),error=>{
      assert.equal(studioTransportDiagnostic(error),code);
      assert.equal(error.message,'Paperclip verification failed.');
      assert.equal(error.cause,undefined);
      return true;
    });
    assert.equal(calls,1);
  }
  assert.equal(studioTransportDiagnostic({code:'http_403',message:'private'}),'transport_unknown');
  assert.equal(studioTransportDiagnostic(new Error('private')),'transport_unknown');
});

test('allowlists bounded causes without revealing error details or relaxing fetch options', async () => {
  const cases = [
    [new TypeError('private', {cause:Object.assign(new Error('private'),{code:'ENOTFOUND'})}), 'dns_failure'],
    [Object.assign(new Error('private'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'}), 'tls_failure'],
    [Object.assign(new Error('private'),{code:'ECONNREFUSED'}), 'connection_refused'],
    [Object.assign(new Error('private'),{code:'ECONNRESET'}), 'connection_reset'],
    [Object.assign(new Error('private'),{code:'ETIMEDOUT'}), 'timeout'],
    [new TypeError('private',{cause:new Error('unexpected redirect')}), 'redirect_rejected'],
    [new TypeError('unrecognized private runtime details'), 'network_type_error'],
    [new DOMException('private','AbortError'), 'request_aborted'],
    [Object.assign(new Error('private'),{code:'PRIVATE_UNKNOWN_CODE'}), 'network_failure'],
  ];
  for(const [failure, expected] of cases) {
    const client=createStudioTransport(config,async(_url,init)=>{
      assert.equal(init.redirect,'manual'); assert.ok(init.signal); throw failure;
    });
    await assert.rejects(client.readAgent(config.agentId),error=>{
      assert.equal(studioTransportDiagnostic(error),expected);
      assert.equal(error.message,'Paperclip verification failed.');
      assert.equal(error.cause,undefined); return true;
    });
  }
});

test('rejects every 3xx without reading Location or contacting any redirect destination', async () => {
  for (const destination of [`${config.origin}/other`, 'https://example.invalid/other']) {
    for (let status=300;status<=399;status++) {
      let calls=0;
      const client=createStudioTransport(config,async(url,init)=>{
        calls++;
        assert.equal(url,`${config.origin}/api/agents/me`);
        assert.equal(init.redirect,'manual');
        assert.equal(init.headers.Authorization,`Bearer ${config.key}`);
        const response=new Response(null,{status,headers:{Location:destination}});
        return new Proxy(response,{get(target,prop){
          if(prop==='headers'||prop==='body'||prop==='ok') throw new Error('Redirect metadata/body must not be read');
          return Reflect.get(target,prop,target);
        }});
      });
      await assert.rejects(client.readAgent(config.agentId),error=>studioTransportDiagnostic(error)==='redirect_rejected');
      assert.equal(calls,1);
    }
  }
});
test('never follows or retries a redirected task submission', async () => {
  let calls=0;
  const client=createStudioTransport(config,async(_url,init)=>{
    calls++; assert.equal(init.method,'POST'); assert.equal(init.redirect,'manual');
    return new Response(null,{status:307,headers:{Location:'https://example.invalid/other'}});
  });
  await assert.rejects(client.createIssue(input),error=>studioTransportDiagnostic(error)==='redirect_rejected');
  assert.equal(calls,1);
});
