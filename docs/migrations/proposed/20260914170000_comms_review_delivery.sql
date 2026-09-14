-- PROPOSED — NOT APPLIED. For Codex review.
--
-- Slice 3: bind a review to the draft it reviewed, bind an approval to the
-- exact payload it approved, and record every delivery attempt once.
--
-- Additive only: no existing column changes type, no existing row is touched,
-- no historical send or queue record is altered. Every column added is
-- nullable or defaulted so that rows written before this migration stay
-- valid; the send gate treats a null binding as "cannot prove approval" and
-- refuses, which is the safe direction.
--
-- Permissions follow the applied hardening file exactly: authenticated may
-- SELECT within its own organization and may not write. Writes come from the
-- verified server service client only.

begin;

-- 1. Which draft a review session is about. Without this no send path can
--    find the review that covers the message in front of it.
alter table public.comms_review_sessions
  add column if not exists draft_id uuid references public.comms_drafts (id) on delete cascade;

create index if not exists comms_review_sessions_draft_idx
  on public.comms_review_sessions (organization_id, draft_id);

-- One live review per draft: two competing reviews of the same draft would
-- make "the current review" ambiguous at the moment of sending.
create unique index if not exists comms_review_sessions_one_open_per_draft
  on public.comms_review_sessions (organization_id, draft_id)
  where draft_id is not null and status <> 'closed';

-- 2. What an approval actually approved. A fingerprint of the exact outbound
--    payload — channel, subject, body, recipient, sending identity and
--    attachments — so an edited message cannot inherit an old approval.
alter table public.comms_review_approvals
  add column if not exists payload_fingerprint text,
  add column if not exists context_fingerprint text,
  add column if not exists context_revision integer;

-- The database stamps the revision rather than trusting the application, and
-- refuses an approval whose run is not the current one for that session.
create or replace function private.comms_stamp_approval()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  run_row public.comms_review_runs;
  session_revision integer;
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

  select context_revision into session_revision
    from public.comms_review_sessions
   where id = new.session_id
     and organization_id = new.organization_id;

  if session_revision is distinct from run_row.context_revision then
    raise exception 'That review is out of date: the conversation changed after it ran.';
  end if;

  new.context_revision := run_row.context_revision;
  new.context_fingerprint := coalesce(new.context_fingerprint, run_row.context_fingerprint);
  return new;
end;
$$;

drop trigger if exists comms_stamp_approval on public.comms_review_approvals;
create trigger comms_stamp_approval
  before insert on public.comms_review_approvals
  for each row execute function private.comms_stamp_approval();

-- 3. Delivery attempts. One row per approved payload per draft, claimed
--    before the provider is called, settled after. The unique key is what
--    makes a double click, a retry and a scheduled run the same attempt.
create table if not exists public.comms_review_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  draft_id uuid not null references public.comms_drafts (id) on delete cascade,
  approval_id uuid not null references public.comms_review_approvals (id) on delete restrict,
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
  constraint comms_review_deliveries_key unique (organization_id, idempotency_key)
);

create index if not exists comms_review_deliveries_draft_idx
  on public.comms_review_deliveries (organization_id, draft_id, attempted_at desc);

alter table public.comms_review_deliveries enable row level security;

revoke all on public.comms_review_deliveries from authenticated, anon;
grant select on public.comms_review_deliveries to authenticated;

drop policy if exists comms_review_deliveries_select on public.comms_review_deliveries;
create policy comms_review_deliveries_select
  on public.comms_review_deliveries
  for select
  to authenticated
  using (private.is_org_member(organization_id));

-- 4. Provenance folded in here rather than as bare columns: the voice rules a
--    review was run against, snapshotted, so a later edit to those rules
--    invalidates the evidence instead of silently changing its meaning.
alter table public.comms_review_runs
  add column if not exists voice_profile_id uuid references public.comms_voice_profiles (id),
  add column if not exists voice_version integer,
  add column if not exists voice_snapshot_checksum text,
  add column if not exists style_context_snapshot jsonb;

-- The voice profile a run cites must belong to the same organization.
create or replace function private.comms_check_run_voice()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  owner uuid;
begin
  if new.voice_profile_id is null then
    return new;
  end if;
  select organization_id into owner
    from public.comms_voice_profiles
   where id = new.voice_profile_id;
  if owner is distinct from new.organization_id then
    raise exception 'A review cannot cite another organization''s voice profile.';
  end if;
  return new;
end;
$$;

drop trigger if exists comms_check_run_voice on public.comms_review_runs;
create trigger comms_check_run_voice
  before insert or update on public.comms_review_runs
  for each row execute function private.comms_check_run_voice();

commit;
