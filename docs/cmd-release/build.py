"""Build reviewable SQL only; never connects to a database."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
fixture = ROOT / 'docs/cmd-business-tasks.fixture.json'
tasks = json.loads(fixture.read_text())['tasks']
assert len(tasks) == 22 and len({t['correlationId'] for t in tasks}) == 22
assert all(t['ownerUserId'] is None and t['ownerLabel'] is None and t['dueAt'] is None for t in tasks)
assert all(t['taskVisibility'] == 'business' and t['status'] != 'complete' and not t['completionEvidence'] for t in tasks)
keys = {t['correlationId'] for t in tasks}
assert all(not t.get('parentCorrelationId') or t['parentCorrelationId'] in keys for t in tasks)
header = '-- GENERATED REVIEW ARTIFACT. Never execute before isolated permission tests pass.\n'
migration = header + '''begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.steward_tasks, public.steward_weekly_goals in access exclusive mode;
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='steward_tasks' and column_name='task_visibility') then
   raise exception 'Migration already applied or schema drift; inspect, do not rerun blindly'; end if;
 if not (select relrowsecurity from pg_class where oid='public.steward_tasks'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.steward_weekly_goals'::regclass) then raise exception 'RLS baseline mismatch'; end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename='steward_tasks')<>5 then raise exception 'Task policy inventory drift'; end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename='steward_weekly_goals')<>5 then raise exception 'Goal policy inventory drift'; end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename in ('steward_tasks','steward_weekly_goals') and
   (permissive <> 'PERMISSIVE' or (cmd<>'ALL' and roles is distinct from array['authenticated']::name[]) or (cmd='ALL' and (roles is distinct from array['public']::name[] or qual is distinct from '(auth.role() = ''service_role''::text)' or with_check is not null)) or (cmd='SELECT' and (qual is distinct from 'private.is_org_member(organization_id)' or roles is distinct from array['authenticated']::name[]))
   or (cmd='UPDATE' and (qual is distinct from 'private.is_org_member(organization_id)' or with_check is distinct from 'private.is_org_member(organization_id)'))
   or (cmd='INSERT' and with_check is distinct from 'private.is_org_member(organization_id)')
   or (cmd='DELETE' and qual is distinct from 'private.is_org_member(organization_id)'))) then raise exception 'Policy baseline expressions differ; review first'; end if;
end $$;
create temporary table cmd_legacy_before on commit drop as select id,to_jsonb(t) original from public.steward_tasks t;
create temporary table cmd_goals_before on commit drop as select id,to_jsonb(t) original from public.steward_weekly_goals t;
'''
for name in ['cmd-task-manager-access.DRAFT.sql','cmd-own-goal-guard.DRAFT.sql']:
    source = (ROOT/'docs'/name).read_text()
    migration += '\n-- Source '+name+' SHA256 '+hashlib.sha256(source.encode()).hexdigest()+'\n'
    migration += '\n'.join(line for line in source.splitlines() if line.strip().lower() not in ('begin;','commit;'))+'\n'
migration += '''do $$ begin
 if exists(select 1 from cmd_legacy_before b full join public.steward_tasks t using(id)
   where b.id is null or t.id is null or b.original is distinct from (to_jsonb(t)-array['task_visibility','next_action','blocked_because','depends_on_task_id','parent_task_id','archived_at','completion_evidence','completed_at','completed_by','revision']))
 then raise exception 'Historical task data changed'; end if;
 if exists(select 1 from public.steward_tasks where task_visibility<>'legacy_shared') then raise exception 'Unexpected historical classification'; end if;
 if exists(select 1 from cmd_goals_before b full join public.steward_weekly_goals t using(id) where b.original is distinct from to_jsonb(t)) then raise exception 'Historical goal data changed'; end if;
end $$;
commit;
'''
(OUT/'migration.review.sql').write_text(migration)
data = json.dumps(tasks, separators=(',', ':'))
assert '$cmd_seed$' not in data
seed = header + '-- Fixture SHA256 '+hashlib.sha256(fixture.read_bytes()).hexdigest()+'\n'+'''begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Temporary release RPC. SECURITY INVOKER retains the approved RLS/trigger rules.
create function public.cmd_import_approved_business_tasks(target_org uuid)
returns table(correlation_id text,task_id uuid,was_inserted boolean)
language plpgsql security invoker set search_path='' as $$
declare item jsonb; existing public.steward_tasks%rowtype; parent_id uuid; inserted_id uuid;
begin
 if auth.uid() is null or not private.is_org_admin(target_org) then raise exception 'Verified active workspace owner/admin required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org::text,0));
 for item in select value from jsonb_array_elements($cmd_seed$'''+data+'''$cmd_seed$::jsonb) loop
   parent_id := null;
   if item->>'parentCorrelationId' is not null then
     select t.id into parent_id from public.steward_tasks t where t.organization_id=target_org and t.task_visibility='business' and t.correlation_id=item->>'parentCorrelationId';
     if parent_id is null then raise exception 'Prepared parent missing'; end if;
   end if;
   if (select count(*) from public.steward_tasks t where t.organization_id=target_org and t.correlation_id=item->>'correlationId')>1 then raise exception 'Ambiguous existing correlation key'; end if;
   select * into existing from public.steward_tasks t where t.organization_id=target_org and t.correlation_id=item->>'correlationId';
   if found then
     if existing.task_visibility<>'business' or existing.source_app is distinct from 'cmd-business'
        or existing.source_entity_type is distinct from 'operational_task' or existing.parent_task_id is distinct from parent_id then
       raise exception 'Import key collision or relationship drift; no records changed'; end if;
     correlation_id := item->>'correlationId'; task_id:=existing.id; was_inserted:=false; return next;
     continue;
   end if;
   insert into public.steward_tasks(organization_id,title,status,task_visibility,correlation_id,source_app,source_entity_type,
     owner_user_id,owner_label,due_at,assignee_kind,priority,next_action,blocked_because,parent_task_id,notes,acceptance_criteria,context_links,subtasks)
   values(target_org,item->>'title',item->>'status','business',item->>'correlationId','cmd-business','operational_task',
     null,null,null,'human','normal',item->>'nextAction',item->>'blockedBecause',parent_id,item->>'notes',item->'acceptanceCriteria',item->'contextLinks',coalesce(item->'subtasks','[]'::jsonb))
   returning id into inserted_id;
   correlation_id:=item->>'correlationId'; task_id:=inserted_id; was_inserted:=true; return next;
 end loop;
end $$;
revoke all on function public.cmd_import_approved_business_tasks(uuid) from public,anon;
grant execute on function public.cmd_import_approved_business_tasks(uuid) to authenticated;
commit;
-- Invoke ONCE through Supabase RPC with the verified owner's actual authenticated
-- session and verified organization UUID. Never manufacture auth.uid()/JWT claims.
-- Retain the 22-row result receipt. Retry is non-overwriting and idempotent.
-- After successful receipt/readback, remove the helper using cleanup.review.sql.
'''
(OUT/'import-helper.review.sql').write_text(seed)
(OUT/'cleanup.review.sql').write_text(header+'begin;\ndrop function if exists public.cmd_import_approved_business_tasks(uuid);\ncommit;\n')
print('Built guarded migration, fixed 22-record import helper and helper cleanup; no database access.')
