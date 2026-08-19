-- Trust Tai OS — Website → Scout signal boundary.
--
-- Two bounded tables only. TrustTai.com is a signal source: it owns attention
-- and intake, and hands completed intakes to Scout. It never writes Roadmap or
-- Projects truth, and it never duplicates a canonical entity:
--   company / prospect identity -> public.prospects   (unchanged)
--   history                     -> public.activities  (unchanged)
--
-- New here:
--   website_intake_submissions  raw inbound intake, provenance, idempotency,
--                               and the link (or deliberate non-link) to Scout
--   website_events              the small attention/funnel event vocabulary
--
-- Idempotent and additive. Safe to run more than once.

create extension if not exists "pgcrypto";

/* --------------------------------------------- website_intake_submissions */

create table if not exists public.website_intake_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- provenance, structural and not merely a tag
  source_app text not null default 'website',
  source_channel text not null default 'website',
  source_type text not null default 'roadmap_intake',

  -- the website's own id: the idempotency key
  submission_id text not null,

  submitted_at timestamptz not null,
  started_at timestamptz,
  received_at timestamptz not null default now(),

  attribution jsonb not null default '{}'::jsonb,
  person jsonb not null default '{}'::jsonb,
  company jsonb not null default '{}'::jsonb,
  -- preserved exactly as the founder gave it; never rewritten
  verbatim jsonb not null default '[]'::jsonb,
  structured jsonb not null default '{}'::jsonb,
  signals jsonb not null default '{}'::jsonb,
  consent jsonb not null default '{}'::jsonb,

  -- routing into Scout. 'unlinked' is a legitimate resting state.
  scout_prospect_id uuid references public.prospects(id) on delete set null,
  link_state text not null default 'unlinked'
    check (link_state in ('linked', 'unlinked')),
  link_reason text not null default '',
  processing_state text not null default 'received'
    check (processing_state in ('received', 'routed', 'held', 'failed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists website_intake_submissions_key_idx
  on public.website_intake_submissions (organization_id, submission_id);
create index if not exists website_intake_submissions_org_time_idx
  on public.website_intake_submissions (organization_id, submitted_at desc);
create index if not exists website_intake_submissions_prospect_idx
  on public.website_intake_submissions (scout_prospect_id);

revoke all on public.website_intake_submissions from anon;
revoke all on public.website_intake_submissions from authenticated;
-- Members read the room. Writes arrive server-side under the service role
-- through the signed receiver, never from a browser.
grant select on public.website_intake_submissions to authenticated;
grant all on public.website_intake_submissions to service_role;

alter table public.website_intake_submissions enable row level security;

drop policy if exists "members read website submissions"
  on public.website_intake_submissions;
create policy "members read website submissions"
  on public.website_intake_submissions
  for select
  to authenticated
  using (private.is_org_member(organization_id));

/* ------------------------------------------------------------ website_events */

create table if not exists public.website_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_name text not null check (event_name in (
    'page_view',
    'intake_view',
    'intake_started',
    'intake_answered',
    'intake_resume_requested',
    'intake_resumed',
    'intake_submitted',
    'intake_abandoned'
  )),
  occurred_at timestamptz not null,
  -- stable key for "the same happening": retries never double count
  event_key text not null,
  session_id text,
  path text,
  referrer text,
  utm jsonb not null default '{}'::jsonb,
  device text,
  submission_id text,
  question_id text,
  modality text check (modality is null or modality in ('text', 'voice')),
  properties jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create unique index if not exists website_events_key_idx
  on public.website_events (organization_id, event_key);
create index if not exists website_events_org_time_idx
  on public.website_events (organization_id, occurred_at desc);
create index if not exists website_events_session_idx
  on public.website_events (organization_id, session_id);

revoke all on public.website_events from anon;
revoke all on public.website_events from authenticated;
grant select on public.website_events to authenticated;
grant all on public.website_events to service_role;

alter table public.website_events enable row level security;

drop policy if exists "members read website events" on public.website_events;
create policy "members read website events"
  on public.website_events
  for select
  to authenticated
  using (private.is_org_member(organization_id));
