-- Voice gate learning loop + earned autonomy (Tai, 2026-09-20).
--
-- The Jev voice pre-gate scores agent drafts before they reach Tai's approval
-- queue. Jev itself is stateless: it cannot learn. Learning lives in the loop
-- AROUND it. These two tables ARE that loop.
--
--   voice_gate_feedback  — the correction log. One row per human action on a
--                          gated draft. Compares what the gate decided against
--                          what Tai actually did. This is the memory Jev lacks
--                          and the only ground truth the rubric improves from.
--
--   voice_gate_authority — per-message-type earned authority. A type stays
--                          bounce-only until its feedback record proves the gate
--                          calls it the way Tai would. Then, and only then, that
--                          type's confident passes may auto-send. Revocable in
--                          one row edit. The graduation is evidence, not trust.
--
-- Idempotent: safe to re-run against production and against a fresh database.

-- ---------------------------------------------------------------------------
-- voice_gate_feedback — the correction log
-- ---------------------------------------------------------------------------
-- Written automatically at the review-state transition (setDraftState). Tai's
-- normal approve / discard / send-back click IS the label. No extra step.
--
-- agreement is the four-cell confusion signal, derived in code:
--   true_pass   gate passed  -> Tai approved/sent            (gate right)
--   false_pass  gate passed  -> Tai discarded/sent-back      (gate too soft)
--   true_bounce gate bounced -> Tai agreed (redraft/discard) (gate right)
--   false_bounce gate bounced-> Tai approved/sent anyway     (gate too harsh)
create table if not exists public.voice_gate_feedback (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  draft_id uuid,
  relationship_id uuid,
  -- What the gate decided when the draft was written (copied from rationale.gate).
  gate_verdict text not null,            -- pass | bounce | error
  gate_grade numeric,                    -- 0-2 sounds_like_tai score, null if not scored
  gate_confidence numeric,               -- 0-1, null if not scored
  gate_reasons jsonb not null default '[]'::jsonb,
  message_type text,                     -- first | ongoing | null
  register text,
  intent text,
  -- What the human did, and the derived agreement cell.
  human_action text not null,            -- approved | sent | discarded | needs_redraft | other
  agreement text not null,               -- true_pass | false_pass | true_bounce | false_bounce | na
  -- Optional: Tai's reason, and the draft text so the weekly review can show it.
  human_reason text,
  draft_excerpt text,
  acted_by uuid,
  created_at timestamptz not null default now(),
  constraint voice_gate_feedback_pkey primary key (id),
  constraint voice_gate_feedback_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint voice_gate_feedback_draft_id_fkey foreign key (draft_id) references public.comms_drafts(id) on delete set null,
  constraint voice_gate_feedback_relationship_id_fkey foreign key (relationship_id) references public.comms_relationships(id) on delete set null,
  constraint voice_gate_feedback_acted_by_fkey foreign key (acted_by) references auth.users(id) on delete set null
);

create index if not exists voice_gate_feedback_org_idx on public.voice_gate_feedback (organization_id, created_at desc);
create index if not exists voice_gate_feedback_type_idx on public.voice_gate_feedback (organization_id, message_type, created_at desc);
create index if not exists voice_gate_feedback_agreement_idx on public.voice_gate_feedback (organization_id, agreement);
create index if not exists voice_gate_feedback_draft_idx on public.voice_gate_feedback (draft_id);

-- ---------------------------------------------------------------------------
-- voice_gate_authority — per-message-type earned autonomy
-- ---------------------------------------------------------------------------
-- One row per (org, message-type). Absent row OR autonomy_state='bounce_only'
-- means the gate only ever bounces (never sends) for that type: the safe
-- default. A type reaches 'auto_send' ONLY through the graduation rule below,
-- and drops back the instant a false_pass appears.
--
-- Graduation bar (Tai, 2026-09-20, conservative default):
--   clean_streak_required = 20 consecutive confident passes Tai also approved,
--   with zero false_passes in the window. One false_pass resets the streak.
-- Failsafe (always, even when graduated):
--   a hard-override hit OR a first-ever contact still bounces to Tai.
create table if not exists public.voice_gate_authority (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  message_type text not null,            -- e.g. scout_first_intro, comms_ongoing
  autonomy_state text not null default 'bounce_only',  -- bounce_only | auto_send
  clean_streak int not null default 0,
  clean_streak_required int not null default 20,
  last_false_pass_at timestamptz,
  graduated_at timestamptz,
  graduated_by uuid,
  notes text,
  updated_at timestamptz not null default now(),
  constraint voice_gate_authority_pkey primary key (id),
  constraint voice_gate_authority_org_type_key unique (organization_id, message_type),
  constraint voice_gate_authority_state_chk check (autonomy_state in ('bounce_only','auto_send')),
  constraint voice_gate_authority_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint voice_gate_authority_graduated_by_fkey foreign key (graduated_by) references auth.users(id) on delete set null
);

create index if not exists voice_gate_authority_org_idx on public.voice_gate_authority (organization_id);

-- ---------------------------------------------------------------------------
-- RLS — same shape as the comms core tables.
-- ---------------------------------------------------------------------------
alter table public.voice_gate_feedback enable row level security;
alter table public.voice_gate_authority enable row level security;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('voice_gate_feedback', 'voice gate feedback'),
      ('voice_gate_authority', 'voice gate authority')
    ) as v(tbl, noun)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = 'Members read ' || t.noun) then
      execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'Members read ' || t.noun, t.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = 'Members write ' || t.noun) then
      execute format('create policy %I on public.%I for insert to authenticated with check (private.is_org_member(organization_id))', 'Members write ' || t.noun, t.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = 'Members update ' || t.noun) then
      execute format('create policy %I on public.%I for update to authenticated using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id))', 'Members update ' || t.noun, t.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = t.tbl || '_service_role') then
      execute format('create policy %I on public.%I for all using (auth.role() = ''service_role''::text)', t.tbl || '_service_role', t.tbl);
    end if;
  end loop;
end $$;
