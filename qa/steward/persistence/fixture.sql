-- Disposable integration fixture only. Never apply to a real database.
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select current_setting('request.jwt.claim.sub',true)::uuid $$;
create table organization_memberships(organization_id uuid,user_id uuid,role text,status text);
create table conversations(id uuid primary key,organization_id uuid,occurred_at timestamptz);
create table commitments(id uuid primary key,organization_id uuid,conversation_id uuid,owner_user_id uuid,project_id uuid,status text,updated_at timestamptz,due_at date);
create table steward_tasks(id uuid primary key,organization_id uuid,owner_user_id uuid,created_by uuid,task_visibility text);
create table activities(id uuid primary key default gen_random_uuid(),organization_id uuid,app_key text,event_type text,actor_user_id uuid,entity_type text,entity_id uuid,source_event_key text,summary text,occurred_at timestamptz,payload jsonb);
create unique index activity_dedupe on activities(organization_id,app_key,source_event_key) where source_event_key is not null;
create function auth.member(org uuid) returns boolean language sql stable as $$ select exists(select 1 from organization_memberships where organization_id=org and user_id=auth.uid() and status='active') $$;
grant usage on schema public,auth to authenticated;
grant select on organization_memberships,commitments,steward_tasks,conversations,activities to authenticated;
grant insert on activities to authenticated;
alter table commitments enable row level security;
alter table conversations enable row level security;
alter table steward_tasks enable row level security;
alter table activities enable row level security;
create policy fixture_commitments on commitments for select to authenticated using(auth.member(organization_id));
create policy fixture_conversations on conversations for select to authenticated using(auth.member(organization_id));
create policy fixture_tasks on steward_tasks for select to authenticated using(auth.member(organization_id) and (task_visibility='business' or owner_user_id=auth.uid()));
create policy fixture_activity_read on activities for select to authenticated using(auth.member(organization_id));
create policy fixture_activity_write on activities for insert to authenticated with check(auth.member(organization_id) and actor_user_id=auth.uid());
insert into organization_memberships values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','member','active');
insert into conversations values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','2026-10-01'),('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','2026-10-20');
insert into commitments values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',null,'open','2026-10-01T00:00:00Z','2026-10-05');

grant update on commitments to authenticated;
create policy fixture_commitment_update on commitments for update to authenticated using(auth.member(organization_id)) with check(auth.member(organization_id));
