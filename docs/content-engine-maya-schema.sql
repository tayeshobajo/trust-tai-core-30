-- Trust Tai OS, the Content Engine command layer (Maya).
--
-- Two additive things, and nothing else:
--
--   content_sources   voice and reference material a person gave the room,
--                     kept once and reused. Reference evidence, never a
--                     second copy of canonical content.
--   content_requests  what Tai actually asked for, which sources were active
--                     for that request, what was inferred, and which
--                     canonical batch resulted from it.
--
-- Canonical articles stay in content_batches / content_items. This migration
-- does not touch them, and it does not touch the publish attempt ledger
-- policy: content_publish_attempts stays SELECT-only for members.
--
-- Idempotent. Apply against the Trust Tai backend (okydosoacqdnursmmenf).

create table if not exists public.content_sources (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'text',            -- text | markdown | linkedin | article | audio | video | document | url
  label text not null,
  origin text not null default '',              -- original filename or URL
  mime_type text not null default '',
  byte_size bigint not null default 0,
  -- Extracted reference text, when extraction was genuinely possible.
  extracted_text text not null default '',
  extraction_state text not null default 'pending',  -- extracted | unsupported | not_configured | failed | pending
  extraction_note text not null default '',
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_sources_org_idx
  on public.content_sources (organization_id, created_at desc);

create table if not exists public.content_requests (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Exactly what the person typed, kept verbatim.
  prompt text not null default '',
  keyword text not null default '',
  post_count integer not null default 10,
  -- Inferred or explicitly set settings, each carrying how it was decided.
  settings jsonb not null default '{}'::jsonb,
  -- Ids of the content_sources that were active for THIS request only.
  source_ids jsonb not null default '[]'::jsonb,
  state text not null default 'submitted',      -- submitted | preparing | prepared | failed
  because text not null default '',
  batch_id text references public.content_batches(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_requests_org_idx
  on public.content_requests (organization_id, created_at desc);
create index if not exists content_requests_batch_idx
  on public.content_requests (organization_id, batch_id);

grant select, insert, update, delete on public.content_sources to authenticated;
grant select, insert, update, delete on public.content_requests to authenticated;
grant all on public.content_sources to service_role;
grant all on public.content_requests to service_role;

alter table public.content_sources enable row level security;
alter table public.content_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_sources'
      and policyname = 'content sources are workspace scoped'
  ) then
    create policy "content sources are workspace scoped"
      on public.content_sources for all to authenticated
      using (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = content_sources.organization_id
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = content_sources.organization_id
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_requests'
      and policyname = 'content requests are workspace scoped'
  ) then
    create policy "content requests are workspace scoped"
      on public.content_requests for all to authenticated
      using (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = content_requests.organization_id
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = content_requests.organization_id
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
      );
  end if;
end $$;
