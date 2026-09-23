-- PROPOSED — Codex-owned. Do not apply from Lovable. Additive only.
-- Scout outreach campaigns: a template and recipients. Drafts live in Comms;
-- this table never sends and holds no delivery authority.

create table if not exists public.scout_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  campaign_key text not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  subject_template text not null check (length(subject_template) <= 300),
  body_template text not null check (length(body_template) <= 8000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, campaign_key)
);

create table if not exists public.scout_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.scout_campaigns(id) on delete cascade,
  scout_person_id uuid not null references public.scout_people(id) on delete cascade,
  relationship_id uuid null references public.comms_relationships(id) on delete set null,
  draft_id uuid null references public.comms_drafts(id) on delete set null,
  blocked_reason text null,
  created_at timestamptz not null default now(),
  unique (campaign_id, scout_person_id)
);

grant select, insert, update on public.scout_campaigns to authenticated;
grant select, insert, update on public.scout_campaign_recipients to authenticated;
grant all on public.scout_campaigns to service_role;
grant all on public.scout_campaign_recipients to service_role;

alter table public.scout_campaigns enable row level security;
alter table public.scout_campaign_recipients enable row level security;

create policy "active members read campaigns" on public.scout_campaigns for select to authenticated
  using (exists (select 1 from public.organization_memberships m
    where m.organization_id = scout_campaigns.organization_id and m.user_id = auth.uid() and m.status = 'active'));
create policy "active members write campaigns" on public.scout_campaigns for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.organization_memberships m
    where m.organization_id = scout_campaigns.organization_id and m.user_id = auth.uid() and m.status = 'active'));
create policy "active members update campaigns" on public.scout_campaigns for update to authenticated
  using (exists (select 1 from public.organization_memberships m
    where m.organization_id = scout_campaigns.organization_id and m.user_id = auth.uid() and m.status = 'active'));

create policy "active members read recipients" on public.scout_campaign_recipients for select to authenticated
  using (exists (select 1 from public.organization_memberships m
    where m.organization_id = scout_campaign_recipients.organization_id and m.user_id = auth.uid() and m.status = 'active'));
create policy "active members write recipients" on public.scout_campaign_recipients for insert to authenticated
  with check (exists (select 1 from public.scout_campaigns c join public.organization_memberships m
    on m.organization_id = c.organization_id
    where c.id = scout_campaign_recipients.campaign_id and c.organization_id = scout_campaign_recipients.organization_id
      and m.user_id = auth.uid() and m.status = 'active'));
create policy "active members update recipients" on public.scout_campaign_recipients for update to authenticated
  using (exists (select 1 from public.organization_memberships m
    where m.organization_id = scout_campaign_recipients.organization_id and m.user_id = auth.uid() and m.status = 'active'));
