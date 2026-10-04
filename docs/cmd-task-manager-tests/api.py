"""Disposable PostgREST JWT/RLS checks; never accepts a production URL."""
import base64,hashlib,hmac,json,os,secrets,socket,subprocess,sys,time,urllib.request,urllib.error
sock=sys.argv[1]
assert sock.startswith('/tmp/cmd-task-db.') and sock.endswith('/socket')
with socket.socket() as reservation:
 reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
secret=secrets.token_urlsafe(48)
env={**os.environ,'PGRST_DB_URI':'postgresql:///cmd_task_manager_test?host='+sock,'PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':secret,'PGRST_SERVER_HOST':'127.0.0.1','PGRST_SERVER_PORT':str(port)}
server=subprocess.Popen(['/opt/homebrew/opt/postgrest/bin/postgrest'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def token(actor):
 enc=lambda v:base64.urlsafe_b64encode(v).decode().rstrip('=')
 head=enc(b'{"alg":"HS256","typ":"JWT"}')
 body=enc(json.dumps({'role':'authenticated','sub':actor,'exp':int(time.time())+120}).encode())
 text=head+'.'+body
 return text+'.'+enc(hmac.new(secret.encode(),text.encode(),hashlib.sha256).digest())
def request(path,actor=None,method='GET',data=None):
 headers={'Content-Type':'application/json','Prefer':'return=representation'}
 if actor: headers['Authorization']='Bearer '+token(actor)
 req=urllib.request.Request(f'http://127.0.0.1:{port}/'+path,headers=headers,method=method,data=None if data is None else json.dumps(data).encode())
 try:
  with urllib.request.urlopen(req,timeout=4) as response:return response.status,json.loads(response.read() or b'null')
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
ids={n:f'00000000-0000-4000-8000-{n:012d}' for n in range(1,7)}
private='steward_tasks?id=eq.00000000-0000-4000-8000-000000000102&select=id,title,notes,completion_evidence'
try:
 for attempt in range(40):
  try: request('');break
  except (urllib.error.URLError,TimeoutError):time.sleep(.1)
 else:raise AssertionError('PostgREST did not start')
 assert len(request(private,ids[1])[1])==1
 for n in [2,3,4,5,6]:assert request(private,ids[n])==(200,[]),n
 assert request(private)[0] in (401,403)
 print('PASS HTTP JWT owner-only personal detail; member/admin/viewer/inactive/cross-org/anonymous denied')
 status,counts=request('rpc/cmd_personal_task_counts',ids[2],'POST',{'target_org':'00000000-0000-4000-8000-000000000010'})
 assert status==200 and counts and all(set(r)=={'owner_user_id','status','task_count'} for r in counts)
 for n in [5,6]:assert request('rpc/cmd_personal_task_counts',ids[n],'POST',{'target_org':'00000000-0000-4000-8000-000000000010'})[0]>=400
 print('PASS HTTP count-only aggregate and workspace denial')
 status,body=request('steward_tasks',ids[4],'POST',{'organization_id':'00000000-0000-4000-8000-000000000010','title':'Denied HTTP viewer fixture','task_visibility':'business'})
 assert status>=400,(status,body)
 status,body=request('steward_weekly_goals?id=eq.00000000-0000-4000-8000-000000000201',ids[2],'PATCH',{'status':'proposed'})
 assert status>=400,(status,body)
 print('PASS HTTP viewer write and other-owner goal transition denial')
finally:
 server.terminate()
 try:server.wait(timeout=5)
 except subprocess.TimeoutExpired:server.kill();server.wait()
