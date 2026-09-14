-- APPLIED to the shared project as `comms_review_delivery_hardened`.
-- Recorded here verbatim. Do not re-run. Supersedes
-- docs/migrations/proposed/20260914170000_comms_review_delivery.sql, which was
-- never applied on its own.

-- Reviewed delivery migration with Codex hardening.
--
-- Slice 3 completion: bind a review to the draft it reviewed, bind an
-- approval to the exact outbound payload it approved, and record every
-- delivery attempt exactly once, with the send rule revalidated inside the
-- database at the moment the attempt is claimed.
--
-- Additive only. No existing column changes type, no existing row is touched,
-- no historical send or queue record is altered. Every column added is
-- nullable or defaulted, so rows written before this migration stay valid;
-- the send gate treats a null binding as "cannot prove approval" and refuses,
-- which is the safe direction.
--
-- Permissions follow the applied hardening file exactly: authenticated may
-- SELECT within its own organization and may not write. Writes come from the
-- verified server service client only, after it has proved the caller.
--
-- Two functions below are SECURITY DEFINER and say why: they are trigger
-- functions that must read rows the writing role can already read, and they
-- exist to enforce an invariant rather than to widen access. The rest are
-- plain SECURITY INVOKER.

begin;

-- ======================================================== 1. review binding

alter table public.comms_review_sessions
  add column if not exists draft_id uuid,
  add column if not exists intended_channel text,
  add column if not exists sender_identity text;

alter table public.comms_review_sessions
  drop constraint if exists comms_review_sessions_channel_chk;
alter table public.comms_review_sessions
  add constraint comms_review_sessions_channel_chk
  check (intended_channel is null
         or intended_channel in ('email_gmail', 'email_resend', 'linkedin_manual'));

-- The draft must live in the same organization as the review. The composite
-- key makes that the database's business, not the application's.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comms_drafts_org_key'
  ) then
    alter table public.comms_drafts
      add constraint comms_drafts_org_key unique (id, organization_id);
  end if;
end
$$;

alter table public.comms_review_sessions
  drop constraint if exists comms_review_sessions_draft_fkey;
alter table public.comms_review_sessions
  add constraint comms_review_sessions_draft_fkey
  foreign key (draft_id, organization_id)
  references public.comms_drafts (id, organization_id) on delete cascade;

create index if not exists comms_review_sessions_draft_idx
  on public.comms_review_sessions (organization_id, draft_id);

-- One live review per draft. Two competing reviews would make "the current
-- review" ambiguous at the moment of sending.
create unique index if not exists comms_review_sessions_one_open_per_draft
  on public.comms_review_sessions (organization_id, draft_id)
  where draft_id is not null and status <> 'closed';

-- Rebinding a review to a different draft, channel or sending identity
-- changes what any earlier review was about, so it moves the revision and
-- every approval given before it stops counting.
create or replace function private.comms_session_binding_moved()
returns trigger
language plpgsql
as $$
begin
  if (new.draft_id, new.intended_channel, new.sender_identity)
     is distinct from (old.draft_id, old.intended_channel, old.sender_identity) then
    new.context_revision := old.context_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists comms_session_binding_moved on public.comms_review_sessions;
create trigger comms_session_binding_moved
  before update on public.comms_review_sessions
  for each row execute function private.comms_session_binding_moved();

-- ============================================== 2. what an approval covers

alter table public.comms_review_approvals
  add column if not exists payload_fingerprint text,
  add column if not exists payload_channel text,
  add column if not exists context_fingerprint_run text,
  -- bigint, to match comms_review_sessions.context_revision exactly.
  add column if not exists context_revision bigint;

alter table public.comms_review_approvals
  drop constraint if exists comms_review_approvals_channel_chk;
alter table public.comms_review_approvals
  add constraint comms_review_approvals_channel_chk
  check (payload_channel is null
         or payload_channel in ('email_gmail', 'email_resend', 'linkedin_manual'));

-- The database stamps the revision rather than trusting the application, and
-- refuses an approval whose run is not the current one for that session.
-- SECURITY DEFINER: it reads the run and session rows to enforce the rule.
create or replace function private.comms_stamp_approval()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  run_row public.comms_review_runs;
  session_row public.comms_review_sessions;
begin
  select * into run_row
    from public.comms_review_runs
   where id = new.run_id
     and organization_id = new.organization_id;

  if run_row.id is null then
    raise exception 'An approval must name a review run in the same organization.';
  end if;
  if run_row.status <> 'complete' then
    raise exception 'An approval requires a completed review run.';
  end if;
  if run_row.session_id <> new.session_id or run_row.version_id <> new.version_id then
    raise exception 'An approval must name the run that read exactly this version of this review.';
  end if;

  -- Lock the session: nothing may move the context between this check and
  -- the stamp that records which context was approved.
  select * into session_row
    from public.comms_review_sessions
   where id = new.session_id
     and organization_id = new.organization_id
     for update;

  if session_row.id is null then
    raise exception 'An approval must belong to a review in the same organization.';
  end if;
  if session_row.context_revision is distinct from run_row.context_revision then
    raise exception 'That review is out of date: the conversation changed after it ran.';
  end if;
  if session_row.draft_id is not null
     and new.payload_channel is distinct from session_row.intended_channel then
    raise exception 'An approval must cover the way this message is actually sent.';
  end if;

  new.context_revision := session_row.context_revision;
  new.context_fingerprint_run := run_row.context_fingerprint;
  return new;
end;
$$;

drop trigger if exists comms_stamp_approval on public.comms_review_approvals;
create trigger comms_stamp_approval
  before insert on public.comms_review_approvals
  for each row execute function private.comms_stamp_approval();

-- ================================================== 3. delivery attempts

create table if not exists public.comms_review_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  draft_id uuid not null,
  approval_id uuid not null,
  channel text not null check (channel in ('email_gmail', 'email_resend', 'linkedin_manual')),
  payload_fingerprint text not null,
  idempotency_key text not null,
  -- 'unknown' is a real outcome: the provider was asked and the answer never
  -- came back. It is never retried automatically and never reported as sent.
  status text not null default 'attempting'
    check (status in ('attempting', 'sent', 'failed', 'unknown')),
  provider_message_id text,
  error_detail text,
  attempted_by uuid not null references auth.users (id),
  attempted_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint comms_review_deliveries_draft_fkey
    foreign key (draft_id, organization_id)
    references public.comms_drafts (id, organization_id) on delete cascade,
  constraint comms_review_deliveries_approval_fkey
    foreign key (approval_id, organization_id)
    references public.comms_review_approvals (id, organization_id) on delete restrict,
  -- The caller's key, and — independently of any key a caller chooses — one
  -- attempt per approved payload per draft. A caller that invents its own
  -- key cannot buy itself a second send.
  constraint comms_review_deliveries_key unique (organization_id, idempotency_key),
  constraint comms_review_deliveries_payload_once
    unique (organization_id, draft_id, payload_fingerprint)
);

create index if not exists comms_review_deliveries_draft_idx
  on public.comms_review_deliveries (organization_id, draft_id, attempted_at desc);

-- An attempt's identity never changes, and its outcome moves one way only:
-- attempting -> sent | failed | unknown, and then nowhere.
create or replace function private.comms_delivery_immutable()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.organization_id, new.draft_id, new.approval_id, new.channel,
      new.payload_fingerprint, new.idempotency_key, new.attempted_by, new.attempted_at)
     is distinct from
     (old.id, old.organization_id, old.draft_id, old.approval_id, old.channel,
      old.payload_fingerprint, old.idempotency_key, old.attempted_by, old.attempted_at) then
    raise exception 'A delivery attempt cannot be rewritten.';
  end if;
  if old.status <> 'attempting' and new.status is distinct from old.status then
    raise exception 'A settled delivery attempt keeps its outcome.';
  end if;
  return new;
end;
$$;

drop trigger if exists comms_delivery_immutable on public.comms_review_deliveries;
create trigger comms_delivery_immutable
  before update on public.comms_review_deliveries
  for each row execute function private.comms_delivery_immutable();

-- The same invariant the server checks, checked again here, inside the
-- transaction that claims the attempt. This closes the gap between "the
-- server decided it was allowed" and "the row was written": nothing can move
-- the review in between, because the session is locked while we look.
-- SECURITY DEFINER: a trigger that must read review rows to enforce the rule.
create or replace function private.comms_delivery_claim_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  approval_row public.comms_review_approvals;
  session_row public.comms_review_sessions;
  run_row public.comms_review_runs;
  open_blockers integer;
begin
  select * into approval_row
    from public.comms_review_approvals
   where id = new.approval_id
     and organization_id = new.organization_id;
  if approval_row.id is null then
    raise exception 'A delivery must name an approval in the same organization.';
  end if;
  if approval_row.payload_fingerprint is distinct from new.payload_fingerprint then
    raise exception 'This is not the message that was approved.';
  end if;
  if approval_row.payload_channel is distinct from new.channel then
    raise exception 'This is not the way the approved message was to be sent.';
  end if;

  select * into session_row
    from public.comms_review_sessions
   where id = approval_row.session_id
     and organization_id = new.organization_id
     for update;
  if session_row.id is null or session_row.draft_id is distinct from new.draft_id then
    raise exception 'The approval named does not cover this draft.';
  end if;
  if session_row.context_revision is distinct from approval_row.context_revision then
    raise exception 'The message or its context changed after it was approved.';
  end if;

  select * into run_row
    from public.comms_review_runs
   where id = approval_row.run_id
     and organization_id = new.organization_id;
  if run_row.id is null or run_row.status <> 'complete' then
    raise exception 'The review behind this approval is not complete.';
  end if;

  select count(*) into open_blockers
    from public.comms_review_findings
   where run_id = approval_row.run_id
     and organization_id = new.organization_id
     and severity = 'must_fix';
  if open_blockers > 0 then
    raise exception 'The review still has something that must be fixed.';
  end if;

  return new;
end;
$$;

drop trigger if exists comms_delivery_claim_guard on public.comms_review_deliveries;
create trigger comms_delivery_claim_guard
  before insert on public.comms_review_deliveries
  for each row execute function private.comms_delivery_claim_guard();

alter table public.comms_review_deliveries enable row level security;

revoke all on public.comms_review_deliveries from public;
revoke all on public.comms_review_deliveries from anon;
revoke all on public.comms_review_deliveries from authenticated;
grant select on public.comms_review_deliveries to authenticated;
grant all on public.comms_review_deliveries to service_role;

drop policy if exists comms_review_deliveries_select on public.comms_review_deliveries;
create policy comms_review_deliveries_select
  on public.comms_review_deliveries
  for select
  to authenticated
  using (private.is_org_member(organization_id));

-- ======================================================== 4. run provenance

alter table public.comms_review_runs
  add column if not exists voice_profile_id uuid references public.comms_voice_profiles (id),
  add column if not exists voice_version integer,
  add column if not exists voice_snapshot_checksum text,
  add column if not exists style_context_snapshot jsonb;

-- The voice a run cites must belong to the same organization, and once a run
-- exists its voice provenance is frozen: an edit to the rules afterwards must
-- invalidate the evidence, never quietly redefine it.
create or replace function private.comms_freeze_run_voice()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  owner uuid;
begin
  if tg_op = 'INSERT' then
    if new.voice_profile_id is not null then
      select organization_id into owner
        from public.comms_voice_profiles
       where id = new.voice_profile_id;
      if owner is distinct from new.organization_id then
        raise exception 'A review cannot cite another organization''s voice profile.';
      end if;
    end if;
    return new;
  end if;

  if (new.voice_profile_id, new.voice_version, new.voice_snapshot_checksum,
      new.style_context_snapshot)
     is distinct from
     (old.voice_profile_id, old.voice_version, old.voice_snapshot_checksum,
      old.style_context_snapshot) then
    raise exception 'The voice a completed review was run against cannot be rewritten.';
  end if;
  return new;
end;
$$;

drop trigger if exists comms_check_run_voice on public.comms_review_runs;
drop trigger if exists comms_freeze_run_voice on public.comms_review_runs;
create trigger comms_freeze_run_voice
  before insert or update on public.comms_review_runs
  for each row execute function private.comms_freeze_run_voice();


-- Codex final hardening: service-only writes, strict claim actor and lifecycle.
revoke delete, truncate on public.comms_review_deliveries from service_role;
alter function private.comms_session_binding_moved() set search_path = '';
alter function private.comms_delivery_immutable() set search_path = '';
alter function private.comms_stamp_approval() security invoker;
alter function private.comms_stamp_approval() set search_path = '';
alter function private.comms_delivery_claim_guard() security invoker;
alter function private.comms_delivery_claim_guard() set search_path = '';
alter function private.comms_freeze_run_voice() security invoker;
alter function private.comms_freeze_run_voice() set search_path = '';
create or replace function private.comms_delivery_actor_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.status <> 'attempting' or new.settled_at is not null or new.provider_message_id is not null then
  raise exception 'A new delivery must start as an unsettled attempt';
 end if;
 if not exists(select 1 from public.organization_memberships where organization_id=new.organization_id
  and user_id=new.attempted_by and status='active' and role in ('owner','admin')) then
  raise exception 'Only an active owner or admin may claim delivery';
 end if;
 if not exists(select 1 from public.comms_review_approvals a join public.comms_review_sessions s
  on s.id=a.session_id and s.organization_id=a.organization_id
  where a.id=new.approval_id and a.organization_id=new.organization_id and s.status<>'closed') then
  raise exception 'A closed review cannot authorize delivery';
 end if;
 if new.payload_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'A SHA-256 payload is required'; end if;
 return new;
end $$;
create trigger comms_delivery_actor_guard before insert on public.comms_review_deliveries
for each row execute function private.comms_delivery_actor_guard();
create or replace function private.comms_delivery_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
 if old.status <> 'attempting' then raise exception 'A settled delivery is immutable'; end if;
 if (to_jsonb(new)-array['status','provider_message_id','error_detail','settled_at']) is distinct from
    (to_jsonb(old)-array['status','provider_message_id','error_detail','settled_at']) then
  raise exception 'Delivery identity is immutable';
 end if;
 if new.status='attempting' or new.settled_at is null then raise exception 'Settlement requires a final outcome and time'; end if;
 return new;
end $$;
-- Authenticated edits to existing data must invalidate review evidence in the
-- same transaction. Definer is needed ONLY here to update protected sessions.
create or replace function private.comms_review_external_context_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_table_name='comms_drafts' then
  if (to_jsonb(new)-array['review_state','updated_at']) is distinct from
     (to_jsonb(old)-array['review_state','updated_at']) then
   update public.comms_review_sessions set context_revision=context_revision+1,status='open'
    where organization_id=new.organization_id and draft_id=new.id and status<>'closed';
  end if;
 elsif tg_table_name='comms_voice_profiles' then
  update public.comms_review_sessions set context_revision=context_revision+1,status='open'
   where organization_id=coalesce(new.organization_id,old.organization_id) and status<>'closed';
 end if;
 return coalesce(new,old);
end $$;
create trigger comms_review_draft_context_changed after update on public.comms_drafts
for each row execute function private.comms_review_external_context_changed();
create trigger comms_review_voice_context_changed after insert or update or delete on public.comms_voice_profiles
for each row execute function private.comms_review_external_context_changed();
revoke all on function private.comms_session_binding_moved(),private.comms_delivery_immutable(),
 private.comms_stamp_approval(),private.comms_delivery_claim_guard(),private.comms_freeze_run_voice(),
 private.comms_delivery_actor_guard(),private.comms_review_external_context_changed() from public,anon,authenticated;
commit;
