"""Run ONLY against the disposable local Unix-socket PostgreSQL fixture."""
import subprocess, concurrent.futures, os, json
from pathlib import Path
cmd=['psql','-h','/tmp/studio-research-pg-socket','-p','55439','-d',os.environ.get('STUDIO_QA_DATABASE','postgres'),'-v','ON_ERROR_STOP=1','-At']
def sql(s,ok=True):
 r=subprocess.run(cmd+['-c',s],text=True,capture_output=True)
 if ok and r.returncode: raise AssertionError(r.stderr)
 if not ok: assert r.returncode, 'Expected refusal'
 return r
# Match the inspected production defaults, including service_role BYPASSRLS.
assert sql("select rolbypassrls from pg_roles where rolname='service_role';").stdout.strip()=='t'
sql("alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role;")
sql("create schema auth; create table auth.users(id uuid primary key); create table public.organizations(id uuid primary key);")
subprocess.run(cmd+['-f',str(Path(os.environ.get('STUDIO_QA_MIGRATION','supabase/migrations/20261106010000_studio_research_requests.sql')))],check=True,capture_output=True)
# Verify the effective ACL, not just RLS behavior, after inherited ALL grants.
for role in ['anon','authenticated','service_role']:
 for privilege in ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']:
  granted=sql(f"select has_table_privilege('{role}','public.studio_research_requests','{privilege}');").stdout.strip()
  expected='t' if role=='service_role' and privilege in ['SELECT','INSERT','UPDATE'] else 'f'
  assert granted==expected, (role,privilege,granted,expected)
org='11111111-1111-4111-8111-111111111111'; req='22222222-2222-4222-8222-222222222222'; user='33333333-3333-4333-8333-333333333333'; issue='44444444-4444-4444-8444-444444444444'
sql(f"insert into organizations values('{org}'); insert into auth.users values('{user}');")
insert=f"set role service_role; insert into studio_research_requests(organization_id,request_id,created_by,topic,company_id,agent_id) values('{org}','{req}','{user}','Fixture topic','aaa4eceb-44fb-4492-823c-65d3d90c5519','5cbc9418-0ff9-4f1c-a807-c0632e26a538');"
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 results=list(pool.map(lambda _:subprocess.run(cmd+['-c',insert],capture_output=True),range(2)))
assert sorted(r.returncode for r in results)==[0,1], [r.stderr for r in results]
for role in ['anon','authenticated']: sql(f'set role {role}; select * from studio_research_requests;',False)
for statement in ['delete from studio_research_requests','truncate studio_research_requests']:
 refusal=sql(f'set role service_role; {statement};',False)
 assert 'permission denied' in refusal.stderr, refusal.stderr
assert sql('select count(*) from studio_research_requests;').stdout.strip()=='1'
sql(f"set role service_role; update studio_research_requests set topic='Changed topic' where request_id='{req}';",False)
sql(f"set role service_role; update studio_research_requests set state='submitted',issue_id='{issue}' where request_id='{req}' and state='dispatching';")
sql(f"set role service_role; update studio_research_requests set state='dispatching',issue_id=null where request_id='{req}';",False)
assert sql(f"set role service_role; update studio_research_requests set state='dispatch_uncertain' where request_id='{req}' and state='dispatching' returning id;").stdout.strip()=='SET\nUPDATE 0'
for payload in [{}, {'requestId':None}, {'requestId':org}, {'requestId':123}, None]:
 encoded=json.dumps(payload)
 refusal=sql(f"set role service_role; update studio_research_requests set result='{encoded}'::jsonb,result_comment_id='{issue}' where request_id='{req}';",False)
 assert 'check constraint' in refusal.stderr, refusal.stderr
assert sql("select count(*) from studio_research_requests where result is null and result_comment_id is null;").stdout.strip()=='1'

sql(f"set role service_role; update studio_research_requests set result='{{\"requestId\":\"{req}\"}}',result_comment_id='{issue}' where request_id='{req}';")
sql(f"set role service_role; update studio_research_requests set result='{{\"requestId\":\"{req}\",\"changed\":true}}' where request_id='{req}';",False)
print('PASS: production-equivalent defaults, exact role ACLs, denied DELETE/TRUNCATE, JSON-null/missing/wrong correlation rejection, migration, one concurrent claim, anon/authenticated denial, immutable identity, no dispatch replay, CAS loser, immutable accepted result')
