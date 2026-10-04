\set ON_ERROR_STOP on
do $$ begin if current_database()<>'cmd_task_manager_test' then raise exception 'Disposable test database required'; end if; end $$;
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')) $$;
create table public.organizations(id uuid primary key);
create table public.organization_memberships(organization_id uuid,user_id uuid,status text,role text);
create table public.profiles(id uuid primary key,full_name text);
create function private.is_org_member(target_org uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.organization_memberships m where m.organization_id=target_org and m.user_id=auth.uid() and m.status='active') $$;
create function private.is_org_admin(target_org uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.organization_memberships m where m.organization_id=target_org and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin')) $$;
\ir ../steward-manual-tasks-schema.sql
\ir ../../supabase/migrations/20260921170000_steward_weekly_goals.sql
-- Existing source columns inspected in production, absent from the original task migration.
alter table public.steward_tasks add column source_app text,add column source_entity_type text,add column source_entity_id uuid;
insert into organizations values ('00000000-0000-4000-8000-000000000010'),('00000000-0000-4000-8000-000000000020');
insert into organization_memberships values
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','active','member'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','active','member'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000003','active','admin'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000004','active','viewer'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000005','inactive','member'),
 ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000006','active','member');
insert into profiles select user_id,'Synthetic user' from organization_memberships;
insert into steward_tasks(id,organization_id,title) values('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000010','Legacy fixture');
\ir ../cmd-release/migration.review.sql
grant usage on schema public,private,auth to authenticated,anon,service_role;
grant select,insert,update,delete on steward_tasks,steward_weekly_goals to authenticated,service_role;
grant select on organization_memberships,profiles to authenticated;
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
create function public.test_denied(statement text,label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
 begin execute statement; exception when raise_exception or insufficient_privilege or unique_violation then rejected:=true; end;
 if not rejected then raise exception 'FAILED expected rejection: %',label; end if;
 raise notice 'PASS: %',label;
end $$;
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
insert into steward_tasks(id,organization_id,title,task_visibility,correlation_id) values
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000010','Business fixture','business','test:business'),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000010','Private fixture','personal','test:personal'),
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000010','Dependency fixture','business','test:dependency');
select test_assert((select created_by=auth.uid() from steward_tasks where id='00000000-0000-4000-8000-000000000101'),'server stamps creator');
select test_assert((select owner_user_id=auth.uid() from steward_tasks where id='00000000-0000-4000-8000-000000000102'),'personal owner stamped');
select test_denied($q$update steward_tasks set id='00000000-0000-4000-8000-000000000199' where id='00000000-0000-4000-8000-000000000101'$q$,'classified primary identity immutable');
select test_denied($q$update steward_tasks set parent_task_id='00000000-0000-4000-8000-000000000102' where id='00000000-0000-4000-8000-000000000104'$q$,'legacy cannot inject private child relationship');
select test_denied($q$insert into steward_tasks(organization_id,title,parent_task_id) values('00000000-0000-4000-8000-000000000010','Legacy relationship injection','00000000-0000-4000-8000-000000000101')$q$,'legacy insert cannot inject board relationship');
select test_assert((select task_visibility='legacy_shared' from steward_tasks where id='00000000-0000-4000-8000-000000000104'),'historical rows preserved');
select test_denied($q$update steward_tasks set task_visibility='business' where id='00000000-0000-4000-8000-000000000102'$q$,'visibility immutable');
select test_denied($q$update steward_tasks set task_visibility='personal' where id='00000000-0000-4000-8000-000000000104'$q$,'no automatic historical reclassification');
update steward_tasks set source_app='cmd-business' where id='00000000-0000-4000-8000-000000000102';
select test_assert((select task_visibility='personal' from steward_tasks where id='00000000-0000-4000-8000-000000000102'),'source metadata cannot spoof privacy');
select test_denied($q$update steward_tasks set owner_user_id='00000000-0000-4000-8000-000000000002' where id='00000000-0000-4000-8000-000000000101'$q$,'member cannot reassign business work');
select test_denied($q$update steward_tasks set created_by='00000000-0000-4000-8000-000000000002' where id='00000000-0000-4000-8000-000000000101'$q$,'creator immutable');
select test_denied($q$update steward_tasks set status='blocked' where id='00000000-0000-4000-8000-000000000101'$q$,'blocker required');
update steward_tasks set status='blocked',blocked_because='Awaiting synthetic check',next_action='Run check',depends_on_task_id='00000000-0000-4000-8000-000000000103' where id='00000000-0000-4000-8000-000000000101';
select test_denied($q$update steward_tasks set depends_on_task_id='00000000-0000-4000-8000-000000000101' where id='00000000-0000-4000-8000-000000000103'$q$,'dependency cycle blocked');
select test_denied($q$update steward_tasks set depends_on_task_id='00000000-0000-4000-8000-000000000102' where id='00000000-0000-4000-8000-000000000101'$q$,'business dependency cannot expose personal work');
select test_denied($q$update steward_tasks set status='complete' where id='00000000-0000-4000-8000-000000000103'$q$,'completion requires evidence');
select test_denied($q$update steward_tasks set status='complete',completion_evidence='Checked result in synthetic test' where id='00000000-0000-4000-8000-000000000101'$q$,'open dependency blocks completion');
update steward_tasks set status='complete',completion_evidence='Checked dependency result in synthetic test' where id='00000000-0000-4000-8000-000000000103';
update steward_tasks set status='complete',completion_evidence='Checked dependent result in synthetic test' where id='00000000-0000-4000-8000-000000000101';
select test_assert((select completed_by=auth.uid() and completed_at is not null from steward_tasks where id='00000000-0000-4000-8000-000000000101'),'atomic completion receipt');
update steward_tasks set status='open' where id='00000000-0000-4000-8000-000000000101';
select test_assert((select completed_at is not null and completion_evidence<>'' from steward_tasks where id='00000000-0000-4000-8000-000000000101'),'reopen retains prior receipt');
update steward_tasks set archived_at=now() where id='00000000-0000-4000-8000-000000000101';
update steward_tasks set archived_at=null where id='00000000-0000-4000-8000-000000000101';
select test_assert((select archived_at is null from steward_tasks where id='00000000-0000-4000-8000-000000000101'),'restore works');
delete from steward_tasks where id='00000000-0000-4000-8000-000000000101';
select test_assert((select count(*)=1 from steward_tasks where id='00000000-0000-4000-8000-000000000101'),'classified hard delete denied by RLS');
select test_denied($q$insert into steward_tasks(organization_id,title,task_visibility,correlation_id) values('00000000-0000-4000-8000-000000000010','duplicate','business','test:business')$q$,'dedupe key unique');
insert into steward_weekly_goals(id,organization_id,owner_user_id,week_start,title) values('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000010',auth.uid(),'2026-09-28','Synthetic goal');
-- One-level audit children cannot be hidden behind a prematurely completed parent.
insert into steward_tasks(id,organization_id,title,task_visibility,parent_task_id) values
 ('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000010','Child fixture','business','00000000-0000-4000-8000-000000000101');
select test_denied($q$update steward_tasks set depends_on_task_id='00000000-0000-4000-8000-000000000101' where id='00000000-0000-4000-8000-000000000105'$q$,'child cannot depend on parent');
update steward_tasks set depends_on_task_id=null where id='00000000-0000-4000-8000-000000000101';
update steward_tasks set depends_on_task_id='00000000-0000-4000-8000-000000000103' where id='00000000-0000-4000-8000-000000000105';
select test_denied($q$update steward_tasks set status='open',depends_on_task_id='00000000-0000-4000-8000-000000000101' where id='00000000-0000-4000-8000-000000000103'$q$,'mixed hierarchy dependency cycle refused');
update steward_tasks set depends_on_task_id=null where id='00000000-0000-4000-8000-000000000105';
update steward_tasks set depends_on_task_id='00000000-0000-4000-8000-000000000103' where id='00000000-0000-4000-8000-000000000101';
select test_denied($q$update steward_tasks set status='complete',completion_evidence='Checked parent result with child unfinished' where id='00000000-0000-4000-8000-000000000101'$q$,'unfinished child blocks parent completion');
select test_denied($q$update steward_tasks set parent_task_id='00000000-0000-4000-8000-000000000105' where id='00000000-0000-4000-8000-000000000103'$q$,'nested parent refused');
select test_denied($q$update steward_tasks set parent_task_id='00000000-0000-4000-8000-000000000102' where id='00000000-0000-4000-8000-000000000105'$q$,'private parent cannot be linked from business task');
update steward_tasks set status='complete',completion_evidence='Checked synthetic child result' where id='00000000-0000-4000-8000-000000000105';
select test_denied($q$update steward_weekly_goals set status='complete' where id='00000000-0000-4000-8000-000000000201'$q$,'goal cannot bypass confirmation');
set role service_role;
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claim.role','service_role',false);
select test_denied($q$update steward_weekly_goals set status='confirmed' where id='00000000-0000-4000-8000-000000000201'$q$,'backend cannot impersonate human confirmer');
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select test_assert((select count(*)=0 from steward_tasks where id='00000000-0000-4000-8000-000000000102'),'other member cannot read private title or detail');
select test_assert((select count(*)=3 from steward_tasks where task_visibility='business'),'member reads shared business');
update steward_tasks set title='Unauthorized change' where id='00000000-0000-4000-8000-000000000101';
select test_assert((select title='Business fixture' from steward_tasks where id='00000000-0000-4000-8000-000000000101'),'unrelated member cannot edit');
select test_assert((select sum(task_count)=1 from cmd_personal_task_counts('00000000-0000-4000-8000-000000000010')),'safe status aggregate works');
select test_denied($q$update steward_weekly_goals set status='confirmed' where id='00000000-0000-4000-8000-000000000201'$q$,'other member cannot confirm goal');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
select test_assert((select count(*)=0 from steward_tasks where task_visibility='personal'),'admin cannot read personal detail');
update steward_tasks set owner_user_id='00000000-0000-4000-8000-000000000002' where id='00000000-0000-4000-8000-000000000101';
select test_denied($q$update steward_weekly_goals set status='confirmed' where id='00000000-0000-4000-8000-000000000201'$q$,'admin cannot confirm another goal');
insert into steward_tasks(id,organization_id,title,task_visibility,owner_user_id) values('00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000010','Admin parent','business',auth.uid());
update steward_tasks set status='open',parent_task_id='00000000-0000-4000-8000-000000000106',owner_user_id='00000000-0000-4000-8000-000000000002' where id='00000000-0000-4000-8000-000000000105';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select test_denied($q$update steward_tasks set parent_task_id=null where id='00000000-0000-4000-8000-000000000105'$q$,'child assignee cannot detach from parent they cannot edit');
update steward_tasks set next_action='Assignee updated next step' where id='00000000-0000-4000-8000-000000000101';
select test_assert((select next_action='Assignee updated next step' from steward_tasks where id='00000000-0000-4000-8000-000000000101'),'assignee can update');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
select test_assert((select count(*)=4 from steward_tasks where task_visibility='business'),'viewer can read business');
select test_denied($q$insert into steward_tasks(organization_id,title,task_visibility) values('00000000-0000-4000-8000-000000000010','viewer write','business')$q$,'viewer cannot create');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',false);
select test_assert((select count(*)=0 from steward_tasks),'inactive member cannot read');
select test_denied($q$select * from cmd_personal_task_counts('00000000-0000-4000-8000-000000000010')$q$,'inactive aggregate denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',false);
select test_assert((select count(*)=0 from steward_tasks),'other workspace cannot read');
select test_denied($q$select * from cmd_personal_task_counts('00000000-0000-4000-8000-000000000010')$q$,'other workspace aggregate denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
update steward_weekly_goals set status='confirmed' where id='00000000-0000-4000-8000-000000000201';
select test_assert((select confirmed_at is not null from steward_weekly_goals where id='00000000-0000-4000-8000-000000000201'),'owner confirmation timestamp server-generated');
select test_denied($q$update steward_weekly_goals set title='Changed confirmed outcome' where id='00000000-0000-4000-8000-000000000201'$q$,'owner must reopen before rewriting confirmed goal');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select test_denied($q$update steward_weekly_goals set linked_task_ids='[]',target_count=999,title='Other member substituted goal' where id='00000000-0000-4000-8000-000000000201'$q$,'other member cannot substitute confirmed outcome');
select test_denied($q$update steward_weekly_goals set status='proposed',title='Other member reopened goal' where id='00000000-0000-4000-8000-000000000201'$q$,'other member cannot reopen confirmed goal');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
update steward_weekly_goals set status='proposed',title='Owner revised proposal' where id='00000000-0000-4000-8000-000000000201';
select test_assert((select confirmed_at is null and completed_at is null from steward_weekly_goals where id='00000000-0000-4000-8000-000000000201'),'revised proposal has no confirmation receipt');
update steward_weekly_goals set status='confirmed' where id='00000000-0000-4000-8000-000000000201';
set role anon;
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claim.role','anon',false);
select test_denied($q$select * from cmd_personal_task_counts('00000000-0000-4000-8000-000000000010')$q$,'anonymous aggregate denied');
select test_denied($q$select * from steward_tasks$q$,'anonymous detail denied');
-- Test the exact release helper only in this disposable database.
reset role;
\ir ../cmd-release/import-helper.review.sql
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
select test_denied($q$select * from cmd_import_approved_business_tasks('00000000-0000-4000-8000-000000000010')$q$,'viewer cannot import');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
select test_assert((select count(*)=22 and bool_and(was_inserted) from cmd_import_approved_business_tasks('00000000-0000-4000-8000-000000000010')),'approved import inserts exactly 22');
select test_assert((select count(*)=22 and not bool_or(was_inserted) from cmd_import_approved_business_tasks('00000000-0000-4000-8000-000000000010')),'approved import retry does not overwrite');
select test_assert((select count(*)=22 from steward_tasks where correlation_id like 'cmd-business:%' and owner_user_id is null and due_at is null and status<>'complete' and completion_evidence=''),'import has no invented owners dates or receipts');
select test_assert((select count(*)=13 from steward_tasks where correlation_id like 'cmd-business:%' and parent_task_id is not null),'13 audit children linked');
reset role;
\ir ../cmd-release/cleanup.review.sql
\echo Schema-backed tests completed against isolated synthetic PostgreSQL.
