-- Organizational principles: the judgment memory's durable store
-- (Step 5 Learning Engine, Tai's rulings 2026-09-24).
--
-- One first-class table, modeled as ORGANIZATIONAL MEMORY, not a Scout or
-- Comms appendage: relationships, sales, roadmaps, delivery, client success,
-- finance, team, content, leadership, improvement all consolidate here.
--
-- A principle is strong within its scope, never assumed universal. Every row
-- carries its own evidence, contradicting evidence, contexts and
-- relationships observed, confidence, and source (inferred | tai_confirmed).
--
-- Lifecycle (ruling 6, decay included), enforced by trigger:
--   provisional -> active -> strengthened
--   active | strengthened -> challenged        (new contradicting evidence)
--   challenged -> strengthened | superseded | retired
-- Nothing is ever hard-deleted: a delete-prevention trigger keeps history,
-- the same discipline the autosend ledgers keep. Supersession links the
-- replacement through superseded_by and records why.
--
-- RLS: members read (the "what is the system learning?" panel), only the
-- server's service role writes. Same pattern as comms_autosend tables.
--
-- NOT APPLIED to any environment by this commit. File only, per the
-- branch-first build authorization.
--
-- Idempotent: safe to re-run against production and a fresh database.

create table if not exists public.organizational_principles (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  -- The principle itself: one transferable plain-English sentence, ideally in
  -- the target form "Tai tends toward X, except in context Y, where evidence
  -- suggests Z."
  principle text not null,
  -- Structured scope: which slice of organizational judgment this belongs to,
  -- and the context tags its evidence actually covers.
  --   domain: relationship_nurture | sales | roadmap | delivery |
  --           client_success | finance | team | content | leadership |
  --           improvement
  --   context_tags: e.g. ["milestone_event"], ["cold_first_touch"]
  scope_domain text not null,
  scope_context_tags jsonb not null default '[]'::jsonb,
  -- Lifecycle status (ruling 6). provisional principles influence nothing.
  status text not null default 'provisional',
  -- Where the principle came from. tai_confirmed promotes immediately but
  -- keeps its evidence and scope; even Tai-taught principles can decay.
  source text not null default 'inferred',
  -- 0..1. Contradicting evidence reduces it instead of being ignored.
  confidence numeric not null default 0.5,
  -- Evidence refs: learning-unit references ({unit_id, draft_id,
  -- relationship_id, captured_at, note}). Append-only by trigger below.
  supporting_evidence jsonb not null default '[]'::jsonb,
  contradicting_evidence jsonb not null default '[]'::jsonb,
  -- Distinct context tags and relationships the evidence actually spans.
  -- Promotion reads these: >= 3 units across >= 2 relationships, and
  -- universality only with >= 2 distinct context tags (ruling 1).
  contexts_observed jsonb not null default '[]'::jsonb,
  relationships_observed jsonb not null default '[]'::jsonb,
  last_validated_at timestamptz,
  -- Supersession: the replacement principle, and why the change happened.
  superseded_by uuid,
  transition_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizational_principles_pkey primary key (id),
  constraint organizational_principles_org_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint organizational_principles_superseded_by_fkey
    foreign key (superseded_by) references public.organizational_principles (id),
  constraint organizational_principles_status_chk
    check (status in ('provisional', 'active', 'strengthened', 'challenged', 'superseded', 'retired')),
  constraint organizational_principles_source_chk
    check (source in ('inferred', 'tai_confirmed')),
  constraint organizational_principles_confidence_chk
    check (confidence >= 0 and confidence <= 1),
  constraint organizational_principles_domain_chk
    check (scope_domain in (
      'relationship_nurture', 'sales', 'roadmap', 'delivery', 'client_success',
      'finance', 'team', 'content', 'leadership', 'improvement'
    ))
);

create index if not exists organizational_principles_org_idx
  on public.organizational_principles (organization_id, status, scope_domain);
create index if not exists organizational_principles_org_updated_idx
  on public.organizational_principles (organization_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Lifecycle guard: only lawful transitions, and history only accretes.
-- ---------------------------------------------------------------------------
create or replace function private.organizational_principle_lifecycle_guard()
returns trigger
language plpgsql
as $$
begin
  -- Identity and provenance never change.
  if (new.id, new.organization_id, new.created_at, new.source)
     is distinct from
     (old.id, old.organization_id, old.created_at, old.source) then
    raise exception 'A principle''s identity and source cannot be rewritten.';
  end if;

  -- Terminal states keep their words and their history.
  if old.status in ('superseded', 'retired') then
    raise exception 'A % principle is history; it cannot change again.', old.status;
  end if;

  -- Evidence is append-only: the arrays may grow, never shrink.
  if jsonb_array_length(new.supporting_evidence) < jsonb_array_length(old.supporting_evidence)
     or jsonb_array_length(new.contradicting_evidence) < jsonb_array_length(old.contradicting_evidence) then
    raise exception 'Principle evidence is append-only; nothing recorded is removed.';
  end if;

  -- Lawful status moves only (ruling 6).
  if new.status is distinct from old.status then
    if not (
      (old.status = 'provisional' and new.status in ('active', 'retired'))
      or (old.status = 'active' and new.status in ('strengthened', 'challenged'))
      or (old.status = 'strengthened' and new.status = 'challenged')
      or (old.status = 'challenged' and new.status in ('strengthened', 'superseded', 'retired'))
    ) then
      raise exception 'Unlawful principle transition: % -> %.', old.status, new.status;
    end if;
    if new.status in ('superseded', 'retired') and coalesce(new.transition_reason, '') = '' then
      raise exception 'Retiring or superseding a principle requires a recorded reason.';
    end if;
    if new.status = 'superseded' and new.superseded_by is null then
      raise exception 'A superseded principle must name its replacement.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists organizational_principle_lifecycle_guard
  on public.organizational_principles;
create trigger organizational_principle_lifecycle_guard
  before update on public.organizational_principles
  for each row execute function private.organizational_principle_lifecycle_guard();

-- ---------------------------------------------------------------------------
-- Delete prevention: principles are never deleted, only retired or superseded
-- with their history intact. Same invariant the ledger tables keep.
-- ---------------------------------------------------------------------------
create or replace function private.organizational_principle_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Principles are never deleted. Retire or supersede them; history stays.';
end;
$$;

drop trigger if exists organizational_principle_no_delete
  on public.organizational_principles;
create trigger organizational_principle_no_delete
  before delete on public.organizational_principles
  for each row execute function private.organizational_principle_no_delete();

-- ---------------------------------------------------------------------------
-- Grants + RLS. Members read; only the server's service role writes.
-- ---------------------------------------------------------------------------
alter table public.organizational_principles enable row level security;

revoke all on public.organizational_principles from public, anon, authenticated;
grant select on public.organizational_principles to authenticated;
grant all on public.organizational_principles to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'organizational_principles'
    and policyname = 'organizational_principles_select') then
    create policy organizational_principles_select on public.organizational_principles
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
end $$;
