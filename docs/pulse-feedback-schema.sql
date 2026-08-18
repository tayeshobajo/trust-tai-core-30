-- Pulse feedback: how prominently Pulse frames a signal. Never business truth.
-- Apply to the Trust Tai Supabase project (ref okydosoacqdnursmmenf).

create table if not exists public.pulse_signal_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  signal_id text not null,
  signal_kind text not null,
  kind text not null check (kind in ('accepted', 'not_now', 'not_useful')),
  signal_title text,
  created_at timestamptz not null default now()
);

create index if not exists pulse_signal_feedback_org_idx
  on public.pulse_signal_feedback (organization_id, created_at desc);
create index if not exists pulse_signal_feedback_kind_idx
  on public.pulse_signal_feedback (organization_id, signal_kind);

grant select, insert on public.pulse_signal_feedback to authenticated;
grant all on public.pulse_signal_feedback to service_role;

alter table public.pulse_signal_feedback enable row level security;

drop policy if exists "members read pulse feedback" on public.pulse_signal_feedback;
create policy "members read pulse feedback"
  on public.pulse_signal_feedback
  for select
  to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "members write pulse feedback" on public.pulse_signal_feedback;
create policy "members write pulse feedback"
  on public.pulse_signal_feedback
  for insert
  to authenticated
  with check (private.is_org_member(organization_id) and user_id = auth.uid());
