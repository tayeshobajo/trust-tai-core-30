-- Trust Tai OS. Comms external integrations schema
--
-- APPLIED. Verified live on the Trust Tai Supabase project
-- (ref okydosoacqdnursmmenf) on 2026-08-22: every table, column, index and
-- function named here answered production probes, including the service-role
-- secret read at the bottom. This project does not own the schema, so this
-- file remains the exact statement set of record: any change must be applied
-- there before code relies on it.
--
-- Additive only. No shared core entity is duplicated: people stay in
-- `contacts`, companies stay in `clients` / `prospects`, history stays in
-- `activities`, relationship state stays in `comms_relationships`.
--
-- Order per table: CREATE TABLE, GRANT, ENABLE RLS, POLICY.
-- Membership is checked with the existing hardened helper
-- `private.is_org_member(uuid)`.

-- --------------------------------------------------------------- integrations
-- One row per organization + provider connection. Status and cursor only.
-- Tokens never live here: see private.comms_integration_secrets below.

create table if not exists public.comms_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  account_email text,
  scopes jsonb not null default '[]'::jsonb,
  cursor jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists comms_integrations_account_idx
  on public.comms_integrations (organization_id, provider, coalesce(account_email, ''));

grant select, insert, update, delete on public.comms_integrations to authenticated;
grant all on public.comms_integrations to service_role;

alter table public.comms_integrations enable row level security;

create policy "Members read integrations"
  on public.comms_integrations for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write integrations"
  on public.comms_integrations for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update integrations"
  on public.comms_integrations for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete integrations"
  on public.comms_integrations for delete to authenticated
  using (private.is_org_member(organization_id));

-- OAuth refresh tokens live in the private schema, reachable only by the
-- service role from server code. No grant to `authenticated`, ever.

create schema if not exists private;

create table if not exists private.comms_integration_secrets (
  integration_id uuid primary key
    references public.comms_integrations(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on private.comms_integration_secrets from anon, authenticated;
grant all on private.comms_integration_secrets to service_role;

alter table private.comms_integration_secrets enable row level security;

-- ------------------------------------------------------------------ messages
-- Per-message record. The unique key is what makes Gmail sync idempotent.

create table if not exists public.comms_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_id uuid references public.comms_relationships(id) on delete cascade,
  thread_id uuid references public.comms_threads(id) on delete set null,
  provider text not null default 'gmail',
  provider_message_id text not null,
  provider_thread_id text,
  direction text not null default 'inbound',
  from_email text,
  from_name text,
  to_emails jsonb not null default '[]'::jsonb,
  cc_emails jsonb not null default '[]'::jsonb,
  subject text,
  snippet text,
  body_text text,
  occurred_at timestamptz not null,
  headers jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists comms_messages_provider_idx
  on public.comms_messages (organization_id, provider, provider_message_id);
create index if not exists comms_messages_thread_idx
  on public.comms_messages (thread_id, occurred_at desc);
create index if not exists comms_messages_rel_idx
  on public.comms_messages (relationship_id, occurred_at desc);

grant select, insert, update, delete on public.comms_messages to authenticated;
grant all on public.comms_messages to service_role;

alter table public.comms_messages enable row level security;

create policy "Members read messages"
  on public.comms_messages for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write messages"
  on public.comms_messages for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update messages"
  on public.comms_messages for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete messages"
  on public.comms_messages for delete to authenticated
  using (private.is_org_member(organization_id));

-- -------------------------------------------------------------- thread columns
-- Threads gain a provider identity, an owner, and their own response clock.

alter table public.comms_threads
  add column if not exists provider text,
  add column if not exists provider_thread_id text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists response_due_at timestamptz;

create unique index if not exists comms_threads_provider_idx
  on public.comms_threads (organization_id, provider, provider_thread_id)
  where provider_thread_id is not null;

-- -------------------------------------------------------------------- events

create table if not exists public.comms_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null default 'manual',
  provider_event_id text,
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  city text,
  region text,
  venue text,
  url text,
  topics jsonb not null default '[]'::jsonb,
  description text,
  observed jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists comms_events_provider_idx
  on public.comms_events (organization_id, source, provider_event_id)
  where provider_event_id is not null;
create index if not exists comms_events_when_idx
  on public.comms_events (organization_id, starts_at);

grant select, insert, update, delete on public.comms_events to authenticated;
grant all on public.comms_events to service_role;

alter table public.comms_events enable row level security;

create policy "Members read events"
  on public.comms_events for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write events"
  on public.comms_events for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update events"
  on public.comms_events for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete events"
  on public.comms_events for delete to authenticated
  using (private.is_org_member(organization_id));

-- ------------------------------------------------------------- event targets
-- Why an event matters and who is worth meeting, always with evidence.

create table if not exists public.comms_event_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.comms_events(id) on delete cascade,
  relationship_id uuid references public.comms_relationships(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  reason_code text not null,
  rationale text not null,
  evidence jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  state text not null default 'suggested',
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comms_event_targets_event_idx
  on public.comms_event_targets (event_id, score desc);

grant select, insert, update, delete on public.comms_event_targets to authenticated;
grant all on public.comms_event_targets to service_role;

alter table public.comms_event_targets enable row level security;

create policy "Members read event targets"
  on public.comms_event_targets for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write event targets"
  on public.comms_event_targets for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update event targets"
  on public.comms_event_targets for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete event targets"
  on public.comms_event_targets for delete to authenticated
  using (private.is_org_member(organization_id));

-- ------------------------------------------------- sealed credential access
-- The refresh token is sealed by the server (AES-GCM under COMMS_TOKEN_ENC_KEY)
-- before it ever leaves the app, so what is stored here is ciphertext. These
-- two functions are the only way in or out. They are SECURITY DEFINER because
-- `authenticated` has no rights in the private schema, and they check
-- membership themselves. A member can therefore hand a sealed value back to
-- the server, but cannot read the token: without the server key the ciphertext
-- is inert.

create or replace function public.comms_put_integration_secret(
  p_integration_id uuid,
  p_ciphertext text
) returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.comms_integrations
  where id = p_integration_id;

  if v_org is null then
    raise exception 'That connection does not exist.';
  end if;
  if not private.is_org_member(v_org) then
    raise exception 'That workspace is not yours.';
  end if;

  insert into private.comms_integration_secrets (integration_id, refresh_token, updated_at)
  values (p_integration_id, p_ciphertext, now())
  on conflict (integration_id)
  do update set refresh_token = excluded.refresh_token, updated_at = now();
end;
$$;

create or replace function public.comms_get_integration_secret(
  p_integration_id uuid
) returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_org uuid;
  v_value text;
begin
  select organization_id into v_org
  from public.comms_integrations
  where id = p_integration_id;

  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That workspace is not yours.';
  end if;

  select refresh_token into v_value
  from private.comms_integration_secrets
  where integration_id = p_integration_id;

  return v_value;
end;
$$;

revoke all on function public.comms_put_integration_secret(uuid, text) from public, anon;
revoke all on function public.comms_get_integration_secret(uuid) from public, anon;
grant execute on function public.comms_put_integration_secret(uuid, text) to authenticated;
grant execute on function public.comms_get_integration_secret(uuid) to authenticated;

-- ------------------------------------- system secret read (service role only)
-- The scheduled sync runs with no member session, so the membership-checked
-- function above cannot serve it: auth.uid() is null under the service role.
-- This variant is the same read with membership replaced by "only the service
-- role may execute it at all". Already live in production (used by the
-- comms-gmail-refresh edge function and the scheduled sweep); recorded here
-- so this file stays the complete statement set.

create or replace function public.comms_get_integration_secret_system(
  p_integration_id uuid
) returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_value text;
begin
  select refresh_token into v_value
  from private.comms_integration_secrets
  where integration_id = p_integration_id;
  return v_value;
end;
$$;

revoke all on function public.comms_get_integration_secret_system(uuid) from public, anon, authenticated;
grant execute on function public.comms_get_integration_secret_system(uuid) to service_role;

-- --------------------------------------------------------------- scheduled sync
-- "Help me never lose an important relationship" cannot depend on someone
-- remembering to press "Read now". One conservative sweep every 6 hours:
-- a short overlapping window (2 days), bounded per mailbox, and a failed
-- mailbox keeps its last successful state and reports "Needs attention".
-- Four passes a day is enough for a reply clock measured in hours-to-days
-- and keeps Gmail API and worker cost negligible. Manual sync stays as the
-- fallback.
--
-- Auth: COMMS_SYNC_CRON_SECRET, a project env secret the endpoint checks
-- with a constant-time compare. It is already set in the app's server
-- environment; paste the same value below before applying. Never commit the
-- real value.
--
-- Apply against the Trust Tai Supabase project:

-- select cron.schedule(
--   'comms-gmail-sync',
--   '17 */6 * * *',
--   $$
--   select net.http_post(
--     url:= 'https://cmd.trusttai.com/api/public/comms/gmail/scheduled-sync',
--     headers:= jsonb_build_object(
--       'Content-Type', 'application/json',
--       'X-Comms-Sync-Key', 'PASTE_COMMS_SYNC_CRON_SECRET'
--     ),
--     body:= '{}'::jsonb
--   );
--   $$
-- );
