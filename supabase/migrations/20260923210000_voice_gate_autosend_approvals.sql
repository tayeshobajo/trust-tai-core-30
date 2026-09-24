-- Graduated auto-send: the system-approval source (Phase 1, Tai 2026-09-23).
--
-- Today every outbound message must be proved approved by the one send
-- authority (src/domain/comms-delivery.ts decideSend): a completed human
-- review of exactly these words, approved by an owner or admin, covering the
-- exact payload fingerprint. That discipline does not change.
--
-- This migration adds a SECOND, equally-provable approval source, for the one
-- case Tai has deliberately graduated: a cold first-contact Scout intro of a
-- message TYPE whose voice_gate_authority row says 'auto_send', that the voice
-- gate passed with confidence, on a relationship that has never replied. When
-- ALL of those hold, the system writes a comms_autosend_approvals row — full
-- provenance, revocable in one edit — and decideSend accepts it exactly as it
-- accepts a human approval: same payload-fingerprint match, or nothing goes.
--
-- Why a separate table, not comms_review_approvals: that table is guarded by
-- comms_review_approval_guard, which REQUIRES approved_by to be an active
-- owner/admin AND a fully-clean completed MODEL review (coverage complete, all
-- obligations answered, no must_fix). A system auto-send has neither a human
-- approver nor a model review run. Reusing that table would mean forging a
-- human review. Instead this is an honest, distinctly-sourced record that the
-- pure decideSend rule reads in parallel. It is never a bypass: no fingerprint
-- match, no send.
--
-- Idempotent: safe to re-run against production and a fresh database.

-- ---------------------------------------------------------------------------
-- Dependency: the (id, organization_id) key on comms_drafts.
-- ---------------------------------------------------------------------------
-- The composite foreign keys below (and the ones the human delivery ledger
-- already uses) reference comms_drafts (id, organization_id), so that pair
-- must be unique. The delivery-hardening migration adds it; add it here too,
-- guarded, so this migration is self-contained on a fresh database.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comms_drafts_org_key'
  ) then
    alter table public.comms_drafts
      add constraint comms_drafts_org_key unique (id, organization_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- comms_autosend_approvals — the system-approval record
-- ---------------------------------------------------------------------------
-- One row per (org, draft, payload_fingerprint). It stands in for exactly what
-- a human approval stands in for, and carries WHY the system was allowed to
-- write it: the graduated authority row, the gate verdict, and the four
-- preconditions, frozen at decision time for audit. Revocable: set
-- revoked_at and the send authority stops accepting it immediately.
create table if not exists public.comms_autosend_approvals (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  draft_id uuid not null,
  relationship_id uuid,
  message_type text not null,               -- e.g. scout_first_intro
  -- Exactly what decideSend compares against. Same shape as a human approval's
  -- payload_fingerprint: sha256 of the canonical outbound message.
  payload_fingerprint text not null,
  payload_channel text not null,
  -- The graduated authority this approval rests on, frozen at write time.
  authority_id uuid,
  authority_state text not null,            -- must be 'auto_send' to be written
  -- The voice-gate verdict that cleared, frozen for audit.
  gate_verdict text not null,               -- pass
  gate_grade numeric,
  gate_confidence numeric,
  gate_reasons jsonb not null default '[]'::jsonb,
  -- The four preconditions, recorded as evidence, not trust.
  preconditions jsonb not null default '{}'::jsonb,
  -- Provenance of who wrote it: always the server, never a browser.
  approved_by_system text not null default 'voice_gate_authority',
  approved_at timestamptz not null default now(),
  -- Revocation. A set revoked_at means the send authority must refuse.
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  created_at timestamptz not null default now(),
  constraint comms_autosend_approvals_pkey primary key (id),
  -- One system-approval per exact message per draft: a retry lands on the same
  -- row, never a second approval.
  constraint comms_autosend_approvals_payload_once
    unique (organization_id, draft_id, payload_fingerprint),
  constraint comms_autosend_approvals_channel_chk
    check (payload_channel in ('email_gmail', 'email_resend', 'linkedin_manual')),
  constraint comms_autosend_approvals_verdict_chk
    check (gate_verdict in ('pass', 'bounce', 'error')),
  constraint comms_autosend_approvals_state_chk
    check (authority_state in ('bounce_only', 'auto_send')),
  constraint comms_autosend_approvals_fingerprint_chk
    check (payload_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint comms_autosend_approvals_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint comms_autosend_approvals_draft_fkey
    foreign key (draft_id, organization_id)
    references public.comms_drafts (id, organization_id) on delete cascade,
  constraint comms_autosend_approvals_relationship_id_fkey
    foreign key (relationship_id) references public.comms_relationships (id) on delete set null,
  constraint comms_autosend_approvals_revoked_by_fkey
    foreign key (revoked_by) references auth.users (id) on delete set null
);

create index if not exists comms_autosend_approvals_org_idx
  on public.comms_autosend_approvals (organization_id, approved_at desc);
create index if not exists comms_autosend_approvals_draft_idx
  on public.comms_autosend_approvals (organization_id, draft_id);
create index if not exists comms_autosend_approvals_type_idx
  on public.comms_autosend_approvals (organization_id, message_type);

-- ---------------------------------------------------------------------------
-- comms_autosend_deliveries — the system-send ledger
-- ---------------------------------------------------------------------------
-- Parallel to comms_review_deliveries, and for the same reason: one row is
-- written BEFORE the provider is asked anything, one outcome after, and
-- 'unknown' when the provider was asked and the answer never came back. It
-- points at a comms_autosend_approvals row (not comms_review_approvals, whose
-- delivery guard requires a human approval). The unique keys make a retry, a
-- double fire, and a racing run all land on one row: only one send happens.
create table if not exists public.comms_autosend_deliveries (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  draft_id uuid not null,
  approval_id uuid not null,
  channel text not null check (channel in ('email_gmail', 'email_resend', 'linkedin_manual')),
  payload_fingerprint text not null,
  idempotency_key text not null,
  status text not null default 'attempting'
    check (status in ('attempting', 'sent', 'failed', 'unknown')),
  provider_message_id text,
  error_detail text,
  attempted_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint comms_autosend_deliveries_pkey primary key (id),
  constraint comms_autosend_deliveries_approval_fkey
    foreign key (approval_id, organization_id)
    references public.comms_autosend_approvals (id, organization_id) on delete restrict,
  constraint comms_autosend_deliveries_draft_fkey
    foreign key (draft_id, organization_id)
    references public.comms_drafts (id, organization_id) on delete cascade,
  constraint comms_autosend_deliveries_key
    unique (organization_id, idempotency_key),
  constraint comms_autosend_deliveries_payload_once
    unique (organization_id, draft_id, payload_fingerprint)
);

-- The approval_id + organization_id pair must be unique for the FK above.
create unique index if not exists comms_autosend_approvals_id_org_key
  on public.comms_autosend_approvals (id, organization_id);

create index if not exists comms_autosend_deliveries_draft_idx
  on public.comms_autosend_deliveries (organization_id, draft_id, attempted_at desc);

-- An attempt's identity never changes, and its outcome moves one way only:
-- attempting -> sent | failed | unknown, then nowhere. Same invariant the
-- human delivery ledger keeps.
create or replace function private.comms_autosend_delivery_immutable()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.organization_id, new.draft_id, new.approval_id, new.channel,
      new.payload_fingerprint, new.idempotency_key, new.attempted_at)
     is distinct from
     (old.id, old.organization_id, old.draft_id, old.approval_id, old.channel,
      old.payload_fingerprint, old.idempotency_key, old.attempted_at) then
    raise exception 'A delivery attempt cannot be rewritten.';
  end if;
  if old.status <> 'attempting' and new.status is distinct from old.status then
    raise exception 'A settled delivery attempt keeps its outcome.';
  end if;
  return new;
end;
$$;

drop trigger if exists comms_autosend_delivery_immutable on public.comms_autosend_deliveries;
create trigger comms_autosend_delivery_immutable
  before update on public.comms_autosend_deliveries
  for each row execute function private.comms_autosend_delivery_immutable();

-- The same invariant the server's decideSend checks, checked again here inside
-- the claim transaction: the named approval must cover exactly this draft,
-- this payload, this channel, and must not be revoked. The session context is
-- irrelevant here because a system-approval carries no review session; the
-- payload fingerprint IS the whole binding, and it is exact.
-- SECURITY DEFINER: reads the approval row to enforce the rule.
create or replace function private.comms_autosend_claim_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  approval_row public.comms_autosend_approvals;
begin
  select * into approval_row
    from public.comms_autosend_approvals
   where id = new.approval_id
     and organization_id = new.organization_id;
  if approval_row.id is null then
    raise exception 'A delivery must name a system-approval in the same organization.';
  end if;
  if approval_row.revoked_at is not null then
    raise exception 'This auto-send approval was revoked.';
  end if;
  if approval_row.authority_state <> 'auto_send' then
    raise exception 'This message type is not graduated for auto-send.';
  end if;
  if approval_row.draft_id is distinct from new.draft_id then
    raise exception 'The approval named does not cover this draft.';
  end if;
  if approval_row.payload_fingerprint is distinct from new.payload_fingerprint then
    raise exception 'This is not the message that was approved.';
  end if;
  if approval_row.payload_channel is distinct from new.channel then
    raise exception 'This is not the way the approved message was to be sent.';
  end if;
  return new;
end;
$$;

drop trigger if exists comms_autosend_claim_guard on public.comms_autosend_deliveries;
create trigger comms_autosend_claim_guard
  before insert on public.comms_autosend_deliveries
  for each row execute function private.comms_autosend_claim_guard();

-- ---------------------------------------------------------------------------
-- Grants + RLS. Members may read (for the audit surface); only the server's
-- service role may write. A browser can never forge a system-approval or a
-- system delivery, exactly as with the human ledger.
-- ---------------------------------------------------------------------------
alter table public.comms_autosend_approvals enable row level security;
alter table public.comms_autosend_deliveries enable row level security;

revoke all on public.comms_autosend_approvals from public, anon, authenticated;
revoke all on public.comms_autosend_deliveries from public, anon, authenticated;
grant select on public.comms_autosend_approvals to authenticated;
grant select on public.comms_autosend_deliveries to authenticated;
grant all on public.comms_autosend_approvals to service_role;
grant all on public.comms_autosend_deliveries to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'comms_autosend_approvals' and policyname = 'comms_autosend_approvals_select') then
    create policy comms_autosend_approvals_select on public.comms_autosend_approvals
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'comms_autosend_deliveries' and policyname = 'comms_autosend_deliveries_select') then
    create policy comms_autosend_deliveries_select on public.comms_autosend_deliveries
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
end $$;
