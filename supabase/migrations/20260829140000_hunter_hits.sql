-- Paperclip Hunter service. Phase 1 data plumbing.
-- Victim-notification threat-intel pipeline for the "NTD Polymorphic Injector"
-- malware family (marker library v1.0: trust-tai/services/paperclip-hunter/marker-library.md).
--
-- Hunter (Paperclip TRUA) writes discovered hits. Verifier/Researcher/Envoy
-- update records through their lifecycle. All external sends stay Tai-gated.

create table if not exists public.hunter_hits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Discovery
  marker_set text not null,              -- e.g. 'tji_loader', 'ptt_cache_loader', 'polymapper_rest', 'bsc_onchain', 'hidden_admin'
  marker_query text not null,            -- exact PublicWWW query string that found it
  domain text not null,
  url text,                              -- most specific indexed URL
  first_seen_at timestamptz not null default now(),
  hunt_batch_id uuid,                    -- groups hits from one Hunter run
  source text not null default 'publicwww',
  raw_result jsonb not null default '{}'::jsonb,  -- raw API row for audit
  -- Verification (Verifier agent)
  verification_status text not null default 'discovered'
    check (verification_status in ('discovered','verifying','confirmed_exploited','cleaned','dead','uncertain','dismissed')),
  verified_at timestamptz,
  verification_evidence jsonb not null default '{}'::jsonb,  -- urlscan refs, fetched snippets
  -- Research (Researcher agent)
  research_status text not null default 'pending'
    check (research_status in ('pending','researching','ready','blocked','not_applicable')),
  registrant_org text,
  registrant_email text,
  host_provider text,                    -- Flywheel/WPE/etc from headers or IP
  contact_channel text,                  -- chosen notification channel
  contact_confidence text check (contact_confidence in ('high','medium','low')),
  researched_at timestamptz,
  -- Outreach (Envoy agent, Tai-gated sends)
  notification_status text not null default 'not_notified'
    check (notification_status in ('not_notified','drafted','approved','sent','bounced','replied','follow_up_due','closed_no_response')),
  draft_comms jsonb,
  sent_at timestamptz,
  sent_message_id text,                  -- Resend message id
  follow_up_due_at timestamptz,
  replied_at timestamptz,
  -- Outcome
  engagement_status text not null default 'none'
    check (engagement_status in ('none','contacted','in_conversation','engaged','declined','remediated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per (domain, marker_set): re-finding a domain under the same marker
-- set updates the existing hit instead of duplicating.
create unique index if not exists hunter_hits_domain_marker_idx
  on public.hunter_hits (organization_id, domain, marker_set);

create index if not exists hunter_hits_status_idx
  on public.hunter_hits (verification_status, notification_status);

create index if not exists hunter_hits_batch_idx
  on public.hunter_hits (hunt_batch_id);

alter table public.hunter_hits enable row level security;

-- Service-role only in v1: Hunter/Verifier/Researcher/Envoy agents run through
-- the existing execution-bridge pattern (service role key), no anon access.
create policy "hunter_hits_service_role_all" on public.hunter_hits
  for all to service_role using (true) with check (true);

-- Registry row so the Hunter agent appears in the execution bridge like Scout.
insert into public.execution_agents (
  organization_id, paperclip_agent_id, name, owning_app, principal, capabilities
)
values (
  (select id from public.organizations order by created_at limit 1),
  'pending_creation',            -- replaced with real Paperclip agent id after create
  'Hunter Threat Intel',
  'paperclip-hunter',
  'paperclip-agent',
  array['threat_intel_scan','publicwww_search','supabase_write:hunter_hits']
)
on conflict (paperclip_agent_id) do update
  set name = excluded.name, capabilities = excluded.capabilities, updated_at = now();
