-- GENERATED REVIEW ARTIFACT. Never execute before isolated permission tests pass.
begin;
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

-- Source cmd-task-manager-access.DRAFT.sql SHA256 210900b733668a37ad65933395b267dcd0cd2079598bde51aa7b662004e7b960
-- REVIEW ONLY: never apply without exact access/migration approval.
-- Historical rows keep legacy_shared. No project/commitment policies are changed.
-- Run with migration-owner privileges; application callers keep authenticated RLS.
alter table public.steward_tasks
  add column task_visibility text not null default 'legacy_shared' check (task_visibility in ('legacy_shared','business','personal')),
  add column next_action text not null default '',
  add column blocked_because text not null default '',
  add column depends_on_task_id uuid references public.steward_tasks(id) on delete restrict,
  add column parent_task_id uuid references public.steward_tasks(id) on delete restrict,
  add column archived_at timestamptz,
  add column completion_evidence text not null default '',
  add column completed_at timestamptz,
  add column completed_by uuid,
  add column revision integer not null default 0;
create index steward_tasks_visibility_idx on public.steward_tasks(organization_id,task_visibility,archived_at);
-- Dedupe only explicitly classified records. Existing source contracts are untouched.
create unique index steward_tasks_board_dedupe_idx on public.steward_tasks(organization_id,correlation_id)
  where task_visibility <> 'legacy_shared' and correlation_id is not null;

create function private.cmd_can_write_tasks(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m where m.organization_id=org
 and m.user_id=auth.uid() and m.status='active'
 and m.role in ('owner','admin','leadership','project_lead','client_support','team_member','member'))
$$;

create function private.cmd_guard_task() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); admin boolean; dependency public.steward_tasks%rowtype; parent public.steward_tasks%rowtype;
begin
 if TG_OP='DELETE' then
   if old.task_visibility <> 'legacy_shared' then raise exception 'Archive this task; permanent deletion is disabled'; end if;
   return old;
 end if;
 if TG_OP='UPDATE' then
   if new.task_visibility is distinct from old.task_visibility then raise exception 'Task visibility is immutable'; end if;
   if old.task_visibility='legacy_shared' then
     if new.parent_task_id is not null or new.depends_on_task_id is not null then raise exception 'Legacy work cannot link board relationships'; end if;
     return new;
   end if;
   if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by
     or new.correlation_id is distinct from old.correlation_id then raise exception 'Task identity is immutable'; end if;
 end if;
 if new.task_visibility='legacy_shared' then
   if new.parent_task_id is not null or new.depends_on_task_id is not null then raise exception 'Legacy work cannot link board relationships'; end if;
   return new;
 end if;
 -- Classified work is human-reviewed; service credentials cannot bypass ownership here.
 if actor is null or not private.cmd_can_write_tasks(new.organization_id) then raise exception 'Task write access required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.organization_id::text, 0));
 admin := private.is_org_admin(new.organization_id);
 if TG_OP='INSERT' then
   new.created_by := actor;
   new.created_at := now();
   new.revision := 0;
   if new.status='complete' then raise exception 'Create work before recording its completion'; end if;
   if new.task_visibility='personal' then new.owner_user_id := actor; end if;
   if new.owner_user_id is not null and new.owner_user_id <> actor and not admin then raise exception 'Only an admin can assign another teammate'; end if;
 else
   if new.task_visibility='personal' then
     if old.owner_user_id is distinct from actor then raise exception 'Only the owner can edit personal work'; end if;
     if new.owner_user_id is distinct from old.owner_user_id then raise exception 'Personal ownership is immutable'; end if;
   else
     if actor is distinct from old.created_by and actor is distinct from old.owner_user_id and not admin then raise exception 'Only creator, assignee or admin can update business work'; end if;
     if new.owner_user_id is distinct from old.owner_user_id and not admin then raise exception 'Only an admin can change assignment'; end if;
   end if;
   new.revision := old.revision + 1;
   new.created_at := old.created_at;
 end if;
 if new.assignee_kind <> 'human' or new.ai_mode is not null then raise exception 'Board work must be reviewed by a person'; end if;
 if new.owner_user_id is not null then
   if not exists(select 1 from public.organization_memberships m where m.organization_id=new.organization_id and m.user_id=new.owner_user_id and m.status='active') then raise exception 'Assignee must be an active teammate'; end if;
   select nullif(trim(p.full_name),'') into new.owner_label from public.profiles p where p.id=new.owner_user_id;
 else new.owner_label := null;
 end if;
 if length(trim(new.title))=0 or length(new.title)>500 then raise exception 'A task title is required (maximum 500 characters)'; end if;
 if new.status='blocked' and length(trim(new.blocked_because))=0 then raise exception 'Record the blocker'; end if;
 if TG_OP='UPDATE' and old.parent_task_id is not null and new.parent_task_id is distinct from old.parent_task_id then
   select * into parent from public.steward_tasks where id=old.parent_task_id;
   if parent.task_visibility='business' and actor is distinct from parent.created_by
      and actor is distinct from parent.owner_user_id and not admin then
     raise exception 'Only an authorized parent editor can remove child work';
   end if;
 end if;
 if new.parent_task_id is not null then
   select * into parent from public.steward_tasks where id=new.parent_task_id;
   if not found or parent.id=new.id or parent.organization_id<>new.organization_id
      or parent.task_visibility<>new.task_visibility or parent.parent_task_id is not null
      or (new.task_visibility='personal' and parent.owner_user_id is distinct from actor)
      or exists(select 1 from public.steward_tasks t where t.parent_task_id=new.id) then
     raise exception 'Choose an accessible top-level task in the same board';
   end if;
   if (TG_OP='INSERT' or new.parent_task_id is distinct from old.parent_task_id)
      and parent.task_visibility='business' and actor is distinct from parent.created_by
      and actor is distinct from parent.owner_user_id and not admin then
     raise exception 'Only an authorized editor can attach child work to this parent';
   end if;
   if parent.status='complete' and new.status<>'complete' then raise exception 'Reopen the parent before adding unfinished work'; end if;
 end if;
 if new.depends_on_task_id is not null then
   if new.depends_on_task_id=new.id then raise exception 'A task cannot depend on itself'; end if;
   select * into dependency from public.steward_tasks where id=new.depends_on_task_id;
   if not found or dependency.organization_id <> new.organization_id
     or dependency.task_visibility <> new.task_visibility
     or (new.task_visibility='personal' and dependency.owner_user_id is distinct from actor) then
     raise exception 'Dependency must be an accessible task in the same board';
   end if;
 end if;
 -- Both a dependency and a parent's children are completion prerequisites.
 -- Check the resulting graph, including NEW, so mixed hierarchy/dependency
 -- cycles cannot leave work impossible to finish.
 if exists(with recursive nodes as (
   select t.id,t.depends_on_task_id,t.parent_task_id from public.steward_tasks t
     where t.organization_id=new.organization_id and t.task_visibility<>'legacy_shared' and t.id<>new.id
   union all select new.id,new.depends_on_task_id,new.parent_task_id
 ), edges as (
   select id src,depends_on_task_id dst from nodes where depends_on_task_id is not null
   union select parent_task_id,id from nodes where parent_task_id is not null
 ), chain as (
   select new.id id,array[new.id] path,false cycle
   union all select e.dst,c.path||e.dst,e.dst=any(c.path)
     from chain c join edges e on e.src=c.id where not c.cycle
 ) select 1 from chain where cycle) then raise exception 'Completion prerequisite cycle is not allowed'; end if;
 if new.status='complete' then
   if exists(select 1 from public.steward_tasks t where t.parent_task_id=new.id and t.status<>'complete') then raise exception 'Complete the child tasks first'; end if;
   if length(trim(new.completion_evidence))<10 then raise exception 'Record the checked result and evidence before completing'; end if;
   if new.depends_on_task_id is not null and dependency.status <> 'complete' then raise exception 'Complete the dependency first'; end if;
   if TG_OP='UPDATE' and old.status='complete' then
     if new.title is distinct from old.title or new.acceptance_criteria is distinct from old.acceptance_criteria
        or new.depends_on_task_id is distinct from old.depends_on_task_id or new.parent_task_id is distinct from old.parent_task_id then
       raise exception 'Reopen before changing delivered work';
     end if;
     new.completed_at := old.completed_at; new.completed_by := old.completed_by;
     if new.completion_evidence is distinct from old.completion_evidence then raise exception 'Reopen before changing completion evidence'; end if;
   else new.completed_at := now(); new.completed_by := actor; end if;
 else
   -- Retain the last completion receipt on reopen; status clearly says not delivered.
   if TG_OP='UPDATE' then
     new.completed_at := old.completed_at; new.completed_by := old.completed_by;
     if new.completion_evidence is distinct from old.completion_evidence then raise exception 'Record evidence when completing the task'; end if;
   else new.completed_at := null; new.completed_by := null; new.completion_evidence := ''; end if;
 end if;
 if TG_OP='INSERT' then new.archived_at := null;
 elsif new.archived_at is distinct from old.archived_at and new.archived_at is not null then new.archived_at := now(); end if;
 new.updated_at := now();
 return new;
end $$;
create trigger cmd_guard_task before insert or update or delete on public.steward_tasks for each row execute function private.cmd_guard_task();

drop policy "Members read steward task" on public.steward_tasks;
create policy "Members read steward task" on public.steward_tasks for select to authenticated using (
 private.is_org_member(organization_id) and (task_visibility <> 'personal' or owner_user_id=auth.uid()));
drop policy "Members write steward task" on public.steward_tasks;
create policy "Members write steward task" on public.steward_tasks for insert to authenticated with check (
 private.is_org_member(organization_id) and (task_visibility='legacy_shared' or
 (private.cmd_can_write_tasks(organization_id) and created_by=auth.uid() and (task_visibility='business' or owner_user_id=auth.uid()))));
drop policy "Members update steward task" on public.steward_tasks;
create policy "Members update steward task" on public.steward_tasks for update to authenticated using (
 private.is_org_member(organization_id) and (task_visibility='legacy_shared' or (private.cmd_can_write_tasks(organization_id) and
 ((task_visibility='personal' and owner_user_id=auth.uid()) or (task_visibility='business' and (created_by=auth.uid() or owner_user_id=auth.uid() or private.is_org_admin(organization_id)))))))
 with check (private.is_org_member(organization_id) and (task_visibility <> 'personal' or owner_user_id=auth.uid()));
drop policy "Members delete steward task" on public.steward_tasks;
create policy "Members delete steward task" on public.steward_tasks for delete to authenticated using (
 private.is_org_member(organization_id) and task_visibility='legacy_shared');

-- Status-only team summary: no IDs, title, notes, source links, goal text or evidence.
create function public.cmd_personal_task_counts(target_org uuid)
returns table(owner_user_id uuid,status text,task_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_org_member(target_org) then raise exception 'Active workspace membership required'; end if;
 return query select t.owner_user_id,t.status,count(*) from public.steward_tasks t
 where t.organization_id=target_org and t.task_visibility='personal' and t.archived_at is null
 group by t.owner_user_id,t.status;
end $$;
revoke all on function public.cmd_personal_task_counts(uuid) from public,anon;
grant execute on function public.cmd_personal_task_counts(uuid) to authenticated;
revoke all on function private.cmd_guard_task() from public,anon,authenticated;
revoke all on function private.cmd_can_write_tasks(uuid) from public,anon;
grant execute on function private.cmd_can_write_tasks(uuid) to authenticated;

-- Source cmd-own-goal-guard.DRAFT.sql SHA256 79dd477f23f58c9a86b0b74671cd4956a7f23c6a9a861f5f62591219b5d804e8
-- REVIEW ONLY. Not an applied migration. No automatic migration-directory entry.
-- Narrow protection for own-goal confirmation without changing shared work access.
-- Test in isolated PostgreSQL first, including authenticated member/admin,
-- anonymous, service role and existing proposal/reconcile flows.

create or replace function public.cmd_guard_weekly_goal_confirmation()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A backend may propose a goal but cannot impersonate its human confirmer.
  if auth.uid() is null and auth.role() is distinct from 'service_role' then raise exception 'Authentication required'; end if;

  if TG_OP = 'INSERT' then
    if new.status <> 'proposed' or new.confirmed_at is not null or new.completed_at is not null then
      raise exception 'Create a proposal before confirming a goal';
    end if;
  else
    if new.id is distinct from old.id or new.owner_user_id is distinct from old.owner_user_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'Goal ownership and workspace cannot be changed';
    end if;
    -- A confirmation applies to this exact outcome, not later substituted text.
    if (old.confirmed_at is not null or old.status in ('confirmed','complete'))
       and new.status <> 'proposed'
       and (new.title is distinct from old.title or new.linked_task_ids is distinct from old.linked_task_ids
         or new.target_count is distinct from old.target_count or new.week_start is distinct from old.week_start
         or new.notes is distinct from old.notes) then
      raise exception 'Reopen the goal as a proposal before changing the confirmed outcome';
    end if;
    if new.status is distinct from old.status
       or new.confirmed_at is distinct from old.confirmed_at
       or new.completed_at is distinct from old.completed_at then
      if auth.uid() is null or old.owner_user_id is distinct from auth.uid() then
        raise exception 'Only the goal owner can change its confirmation';
      end if;
      if new.status = 'confirmed' and old.status <> 'proposed' then
        raise exception 'Only a proposed goal can be confirmed';
      end if;
      if new.status = 'complete' and old.status <> 'confirmed' then raise exception 'Confirm a goal before completing it'; end if;
      if new.status = 'confirmed' then new.confirmed_at := now(); else new.confirmed_at := old.confirmed_at; end if;
      if new.status = 'complete' then new.completed_at := now(); else new.completed_at := old.completed_at; end if;
      if new.status = 'proposed' then new.confirmed_at := null; new.completed_at := null; end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger cmd_guard_weekly_goal_confirmation
before insert or update on public.steward_weekly_goals
for each row execute function public.cmd_guard_weekly_goal_confirmation();

revoke all on function public.cmd_guard_weekly_goal_confirmation() from public, anon, authenticated;

do $$ begin
 if exists(select 1 from cmd_legacy_before b full join public.steward_tasks t using(id)
   where b.id is null or t.id is null or b.original is distinct from (to_jsonb(t)-array['task_visibility','next_action','blocked_because','depends_on_task_id','parent_task_id','archived_at','completion_evidence','completed_at','completed_by','revision']))
 then raise exception 'Historical task data changed'; end if;
 if exists(select 1 from public.steward_tasks where task_visibility<>'legacy_shared') then raise exception 'Unexpected historical classification'; end if;
 if exists(select 1 from cmd_goals_before b full join public.steward_weekly_goals t using(id) where b.original is distinct from to_jsonb(t)) then raise exception 'Historical goal data changed'; end if;
end $$;
commit;
