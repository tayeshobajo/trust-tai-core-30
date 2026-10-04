"""Real concurrent sessions in the disposable cluster only."""
import os
from pathlib import Path
import subprocess
import sys
import time

bin_dir, socket_dir = sys.argv[1:]
assert socket_dir.startswith('/tmp/cmd-task-db.') and socket_dir.endswith('/socket')
base = [bin_dir+'/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket_dir,'-d','cmd_task_manager_test']
def run(sql):
    return subprocess.run(base+['-c',sql],text=True,capture_output=True,check=True).stdout

def concurrent(a,b):
    first=subprocess.Popen(base+['-c',a],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    time.sleep(.1)
    second=subprocess.Popen(base+['-c',b],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    ar=first.communicate(timeout=20);br=second.communicate(timeout=20)
    return [(first.returncode,ar),(second.returncode,br)]

org='00000000-0000-4000-8000-000000000010'
actor='00000000-0000-4000-8000-000000000001'
a='00000000-0000-4000-8000-000000000301';b='00000000-0000-4000-8000-000000000302'
prefix=f"set role authenticated; select set_config('request.jwt.claim.sub','{actor}',false); select set_config('request.jwt.claim.role','authenticated',false);"
run(prefix+f"insert into steward_tasks(id,organization_id,title,task_visibility) values('{a}','{org}','Concurrent A','business'),('{b}','{org}','Concurrent B','business');")
for field in ['depends_on_task_id','parent_task_id']:
    run(prefix+f"update steward_tasks set depends_on_task_id=null,parent_task_id=null where id in ('{a}','{b}');")
    results=concurrent(prefix+f"begin; update steward_tasks set {field}='{b}' where id='{a}'; select pg_sleep(.5); commit;",prefix+f"begin; update steward_tasks set {field}='{a}' where id='{b}'; commit;")
    assert sum(code==0 for code,_ in results)==1, results
    errors=' '.join(io[1] for code,io in results if code)
    assert 'cycle' in errors or 'top-level' in errors or 'deadlock' in errors,errors
    assert run(f"select count(*) from steward_tasks where id in ('{a}','{b}') and {field} is not null;").strip()=='1'
    print('PASS concurrent opposite '+field+' rejects one write without a committed cycle')
helper=Path(__file__).resolve().parents[1]/'cmd-release/import-helper.review.sql'
subprocess.run(base+['-f',str(helper)],check=True,capture_output=True)
org2='00000000-0000-4000-8000-000000000020';actor2='00000000-0000-4000-8000-000000000006'
run(f"update organization_memberships set role='admin' where organization_id='{org2}' and user_id='{actor2}';")
seed_prefix=prefix.replace(actor,actor2)
sql=seed_prefix+f"select count(*) from cmd_import_approved_business_tasks('{org2}');"
results=concurrent(sql,sql)
assert all(code==0 for code,_ in results),results
assert run(f"select count(*) from steward_tasks where organization_id='{org2}' and correlation_id like 'cmd-business:%';").strip()=='22'
print('PASS concurrent imports create exactly 22 records')
run('drop function public.cmd_import_approved_business_tasks(uuid);')
