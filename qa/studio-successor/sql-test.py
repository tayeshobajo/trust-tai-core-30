"""Isolated synthetic PostgreSQL harness; never connects to a configured service."""
from pathlib import Path
import tempfile, subprocess, json, os
root=Path(tempfile.mkdtemp(prefix='studio-successor-pg-',dir='/tmp')); pg='/opt/homebrew/opt/postgresql@17/bin/'
env={**os.environ,'PGHOST':str(root),'PGPORT':'55497','PGUSER':os.environ.get('USER','tayeshobajo'),'PGDATABASE':'postgres'}
def cmd(args,**kw):return subprocess.run(args,env=env,text=True,capture_output=True,**kw)
def sql(s,ok=True):
 r=cmd([pg+'psql','-X','-v','ON_ERROR_STOP=1','-At'],input=s)
 if ok and r.returncode: raise RuntimeError(r.stderr)
 if not ok and not r.returncode:raise RuntimeError('expected SQL rejection')
 return r
r=cmd([pg+'initdb','-D',str(root/'data'),'-A','trust','--no-locale']); assert r.returncode==0,r.stderr
assert cmd([pg+'pg_ctl','-D',str(root/'data'),'-l',str(root/'log'),'-o',f"-k {root} -p 55497 -h ''",'-w','start']).returncode==0
try:
 sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role; CREATE TABLE public.studio_research_requests(request_id uuid PRIMARY KEY,coordinator_approval jsonb,created_by uuid,coordinator_admission jsonb,coordinator_brief jsonb,coordinator_result_digest text);')
 for f in ['20261114000100_studio_attempt_v2_candidate.sql','20261114000200_studio_successor_candidate.sql']:sql(Path('supabase/migrations',f).read_text())
 # All fixtures are fictional, with current local database clock.
 sql("""CREATE TABLE fixture AS SELECT
 '11111111-1111-4111-8111-111111111111'::uuid req,
 '22222222-2222-4222-8222-222222222222'::uuid predecessor,
 '33333333-3333-4333-8333-333333333333'::uuid root_run,
 '44444444-4444-4444-8444-444444444444'::uuid prior_run,
 '55555555-5555-4555-8555-555555555555'::uuid successor,
 '66666666-6666-4666-8666-666666666666'::uuid next_run,
 '77777777-7777-4777-8777-777777777777'::uuid subject,
 floor(extract(epoch from clock_timestamp())*1000)::bigint ms;
 INSERT INTO studio_research_requests SELECT req,'{}',subject,jsonb_build_object('runId',root_run),null,null FROM fixture;
 INSERT INTO studio_research_attempts_v2(attempt_id,request_id,prior_run_id,approval,approval_digest)
 SELECT predecessor,req,root_run,jsonb_build_object('version',2,'duplicateCostAccepted',true,'attemptId',predecessor,'runId',prior_run,'priorRunId',root_run,'historicalApproval','{}'::jsonb,'subjectId',subject,'expiresAt',ms-1000,'nonce','old_nonce','sessionId','old_session','policyDigest',repeat('b',64)),repeat('a',64) FROM fixture;
 CREATE TABLE candidate AS SELECT successor attempt_id,req request_id,root_run prior_run_id,predecessor predecessor_attempt_id,
 jsonb_build_object('version',3,'domain','studio-successor-approval/v1','duplicateCostAccepted',true,'attemptId',successor,'runId',next_run,'priorRunId',root_run,'historicalApproval','{}'::jsonb,'subjectId',subject,'expiresAt',ms+800000,'approvedAt',ms,'nonce','new_nonce','sessionId','new_session','policyDigest',repeat('b',64),'predecessorAttemptId',predecessor,'predecessorRunId',prior_run,'predecessorApprovalDigest',repeat('a',64),'predecessorExpiresAt',ms-1000,'userApprovalReference','synthetic-only') approval,
 repeat('c',64) approval_digest,'synthetic-token' reservation_token,
 jsonb_build_object('domain','studio-successor-reservation/v1','approvalDigest',repeat('c',64),'predecessorApprovalDigest',repeat('a',64),'attemptId',successor,'predecessorAttemptId',predecessor,'priorRunId',root_run,'issuedAt',ms,'expiresAt',ms+60000,'predecessorUnclaimed',true) reservation FROM fixture;
 """)
 insert='INSERT INTO studio_research_attempts_v3(attempt_id,request_id,prior_run_id,predecessor_attempt_id,approval,approval_digest,reservation_token,reservation) SELECT * FROM candidate;'
 for mutation in ["approval=jsonb_set(approval,'{predecessorApprovalDigest}',to_jsonb(repeat('d',64)))", "approval=approval-'predecessorAttemptId'", "approval=jsonb_set(approval,'{nonce}','\"old_nonce\"')", "reservation=reservation-'predecessorUnclaimed'", "reservation=jsonb_set(reservation,'{expiresAt}','0')"]:
  sql('BEGIN; UPDATE candidate SET '+mutation+';'+insert+'ROLLBACK;',False)
 # Cancellation wins: subsequent registration fails. Entire synthetic transaction rolls back.
 sql("BEGIN; SELECT studio_attempt_cancel_v2((SELECT predecessor FROM fixture));"+insert+'ROLLBACK;',False)
 # A registration must use time after acquiring the predecessor lock.
 sql("UPDATE candidate SET reservation=jsonb_set(jsonb_set(reservation,'{issuedAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint)),'{expiresAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint+250));")
 lock=subprocess.Popen([pg+'psql','-X','-v','ON_ERROR_STOP=1','-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 lock.stdin.write("BEGIN; SELECT 'locked' FROM studio_research_attempts_v2 FOR UPDATE; SELECT pg_sleep(1); COMMIT;");lock.stdin.close()
 assert lock.stdout.readline().strip()=='BEGIN'
 assert lock.stdout.readline().strip()=='locked'
 sql(insert,False);lock.wait();assert lock.returncode==0
 sql("UPDATE candidate SET reservation=jsonb_set(jsonb_set(reservation,'{issuedAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint)),'{expiresAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint+60000));")
 # Competing registrations serialize on the predecessor row; exactly one succeeds.
 a=subprocess.Popen([pg+'psql','-X','-v','ON_ERROR_STOP=1','-At'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 a.stdin.write('BEGIN;'+insert+'SELECT pg_sleep(0.5);COMMIT;');a.stdin.close()
 assert a.stdout.readline().strip()=='BEGIN'
 assert a.stdout.readline().strip()=='INSERT 0 1'
 b=sql(insert,False);a.wait();assert a.returncode==0,a.stderr.read()
 assert sql('SELECT count(*) FROM studio_research_attempts_v3').stdout.strip()=='1'
 sql("SELECT studio_attempt_cancel_v2((SELECT predecessor FROM fixture));",False)
 sql("UPDATE studio_research_attempts_v3 SET approval=approval-'domain';",False)
 sql('DELETE FROM studio_research_attempts_v3;',False)
 sql('SET ROLE authenticated; SELECT * FROM studio_research_attempts_v3;',False)
 sql("SET ROLE service_role; UPDATE studio_research_attempts_v3 SET state='{}';",False)
 sql("SET ROLE service_role; UPDATE studio_research_attempts_v2 SET state='{}';",False)
 sql("SET ROLE service_role; INSERT INTO studio_attempt_packets_v3 VALUES('55555555-5555-4555-8555-555555555555',1,'x','{}');",False)
 assert sql("SELECT (state->>'revision')||':'||(state->>'cancelled') FROM studio_research_attempts_v2").stdout.strip()=='0:false'
 # CAS operations remain usable for successor cancellation and immutable for predecessor.
 sql('SELECT studio_attempt_cancel_v3((SELECT successor FROM fixture));')
 assert sql("SELECT state->>'cancelled' FROM studio_research_attempts_v3").stdout.strip()=='true'
 print('PASS: isolated additive migrations, invalid/missing bindings, cancellation/registration ordering, concurrent duplicate reservation, immutable history, RLS, successor cancellation')
finally:
 cmd([pg+'pg_ctl','-D',str(root/'data'),'-m','immediate','-w','stop'])
 print('isolated fixture retained at',root)
