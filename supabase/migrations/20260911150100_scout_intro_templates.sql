-- Scout intro templates.
--
-- Human-authored message templates the Scout agent may draft FROM. Templates
-- are configuration: a person writes them, a person edits them, and every
-- draft produced from one still lands in comms_drafts for human review.
-- Nothing here sends.
--
-- send_window is advisory scheduling configuration, e.g.
--   {"days":[1,2,3,4,5],"start_hour":8,"end_hour":18,"tz":"America/Chicago"}
--
-- The weekly intro cap is NOT a column here. It lives in
-- organization_activity_targets under stream = 'scout_intros'.

create table if not exists public.scout_intro_templates (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  subject text,
  body text not null,
  active boolean not null default true,
  send_window jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scout_intro_templates_pkey primary key (id),
  constraint scout_intro_templates_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint scout_intro_templates_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null
);

create index if not exists scout_intro_templates_org_idx
  on public.scout_intro_templates (organization_id, active, updated_at desc);

alter table public.scout_intro_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scout_intro_templates' and policyname = 'Members read intro templates') then
    create policy "Members read intro templates" on public.scout_intro_templates
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scout_intro_templates' and policyname = 'Members write intro templates') then
    create policy "Members write intro templates" on public.scout_intro_templates
      for insert to authenticated with check (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scout_intro_templates' and policyname = 'Members update intro templates') then
    create policy "Members update intro templates" on public.scout_intro_templates
      for update to authenticated using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scout_intro_templates' and policyname = 'Members delete intro templates') then
    create policy "Members delete intro templates" on public.scout_intro_templates
      for delete to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scout_intro_templates' and policyname = 'scout_intro_templates_service_role') then
    create policy "scout_intro_templates_service_role" on public.scout_intro_templates
      for all using (auth.role() = 'service_role'::text);
  end if;
end
$$;
