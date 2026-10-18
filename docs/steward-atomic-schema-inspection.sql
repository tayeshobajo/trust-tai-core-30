-- READ ONLY. Run against the existing external Trust Tai database.
-- No commitment rows, private transcripts or credentials are returned.
-- This is inspection SQL, NOT a migration and NOT an application script.

select current_database(), current_setting('server_version') as server_version;

select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('commitments', 'steward_task_state', 'activities',
                     'organization_memberships', 'conversations')
order by table_name, ordinal_position;

select c.relname as table_name, con.conname, con.contype,
       pg_catalog.pg_get_constraintdef(con.oid) as definition
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('commitments', 'steward_task_state', 'activities',
                   'organization_memberships', 'conversations')
order by c.relname, con.conname;

select tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename in ('commitments', 'steward_task_state', 'activities',
                   'organization_memberships', 'conversations')
order by tablename, indexname;

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('commitments', 'steward_task_state', 'activities',
                   'organization_memberships', 'conversations')
order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('commitments', 'steward_task_state', 'activities',
                     'organization_memberships', 'conversations')
order by table_name, grantee, privilege_type;

select c.relname as table_name, t.tgname,
       pg_catalog.pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public'
  and c.relname in ('commitments', 'steward_task_state', 'activities')
order by c.relname, t.tgname;

select n.nspname, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig, p.proacl,
       pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname = 'transition_steward_commitment')
   or (n.nspname = 'private' and p.proname in ('is_org_member', 'is_org_admin'))
order by n.nspname, p.proname;