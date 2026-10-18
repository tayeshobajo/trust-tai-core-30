-- Disposable fixture schema for the isolated harness ONLY. Mirrors the
-- columns the proposed functions touch; it is not the hosted schema and is
-- never applied anywhere but a throwaway local database.

create table steward_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  title text not null,
  task_visibility text not null default 'business',
  owner_user_id uuid,
  created_by uuid,
  status text not null default 'open',
  completion_evidence text,
  completed_at timestamptz,
  completed_by text,
  archived_at timestamptz,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);

-- The proposed patches revoke from `anon`; the disposable database needs the
-- role to exist for the revoke statements to parse.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- Fixture identities
\set org_a '''11111111-1111-1111-1111-111111111111'''
\set org_b '''22222222-2222-2222-2222-222222222222'''
\set user_owner '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set user_member '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set user_outsider '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set conv_1 '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set prop_1 '''eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'''
\set prop_2 '''ffffffff-ffff-ffff-ffff-ffffffffffff'''

insert into steward_tasks (id, organization_id, title, owner_user_id, created_by)
values
  ('10000000-0000-0000-0000-000000000001', :org_a, 'Artist website mockup', :user_owner, :user_owner),
  ('10000000-0000-0000-0000-000000000002', :org_a, 'Phased artist-growth roadmap', :user_member, :user_member),
  ('10000000-0000-0000-0000-000000000003', :org_b, 'Other org task', :user_outsider, :user_outsider);

insert into steward_tasks (id, organization_id, title, owner_user_id, created_by, archived_at)
values
  ('10000000-0000-0000-0000-000000000004', :org_a, 'Archived required work', :user_owner, :user_owner, now());
