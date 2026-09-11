-- Studio briefs and opportunity decisions (Slice B).
--
-- Studio derives opportunities per request from Website's observed truth; it
-- never stores a score. What a person decides about an opportunity, and the
-- brief they keep, are durable. That is all that lives here.
--
--   studio_opportunity_decisions  one row per opportunity id per organization:
--                                 open / brief_built / dismissed / acted.
--   studio_content_briefs         one row per kept brief.
--   studio_opportunity_corrections reserved for the corrections panel: a human
--                                 rewrite of observed evidence or Studio's
--                                 read, which outranks inference on the next
--                                 run. Created now so this file is applied once.
--
-- Until this is applied, Studio still shows what it noticed and still builds a
-- brief; it simply says the brief store is not provisioned yet rather than
-- pretending the brief was kept.

/* ------------------------------------------------------- decisions ------ */

create table if not exists public.studio_opportunity_decisions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    opportunity_id text not null,
    subject_label text,
    state text not null default 'open',
    note text,
    decided_by uuid,
    decided_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint studio_opportunity_decisions_uniq unique (organization_id, opportunity_id),
    constraint studio_opportunity_decisions_state_chk
        check (state in ('open', 'brief_built', 'dismissed', 'acted'))
);

/* ---------------------------------------------------------- briefs ------ */

create table if not exists public.studio_content_briefs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    source_opportunity_id text,
    core_idea text not null default '',
    angle text not null default '',
    audience_language jsonb not null default '[]'::jsonb,
    title_candidates jsonb not null default '[]'::jsonb,
    chosen_title text,
    opening jsonb not null default '{}'::jsonb,
    spine jsonb not null default '{}'::jsonb,
    seo jsonb not null default '{}'::jsonb,
    image_plan jsonb not null default '{}'::jsonb,
    provenance jsonb not null default '{}'::jsonb,
    state text not null default 'draft',
    created_by uuid,
    approved_by uuid,
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint studio_content_briefs_org_opportunity_uniq
        unique (organization_id, source_opportunity_id),
    constraint studio_content_briefs_state_chk check (state in ('draft', 'approved', 'discarded'))
);

-- Existing Slice B installations predate the opportunity uniqueness guard.
-- PostgreSQL permits multiple null source ids, so future manual briefs remain
-- possible while retries cannot create two briefs for the same opportunity.
do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.studio_content_briefs'::regclass
          and conname = 'studio_content_briefs_org_opportunity_uniq'
    ) then
        alter table public.studio_content_briefs
            add constraint studio_content_briefs_org_opportunity_uniq
            unique (organization_id, source_opportunity_id);
    end if;
end $$;

/* ----------------------------------------------------- corrections ------ */

create table if not exists public.studio_opportunity_corrections (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    opportunity_id text not null,
    -- 'observed' corrects the evidence, 'read' corrects Studio's reading.
    field text not null,
    original_text text,
    corrected_text text not null,
    because text,
    corrected_by uuid,
    corrected_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint studio_opportunity_corrections_field_chk check (field in ('observed', 'read'))
);

/* -------------------------------------------------------- grants -------- */

grant select, insert, update on public.studio_opportunity_decisions to authenticated;
grant all on public.studio_opportunity_decisions to service_role;

grant select, insert, update on public.studio_content_briefs to authenticated;
grant all on public.studio_content_briefs to service_role;

grant select, insert on public.studio_opportunity_corrections to authenticated;
grant all on public.studio_opportunity_corrections to service_role;

/* ----------------------------------------------------------- rls -------- */

alter table public.studio_opportunity_decisions enable row level security;
alter table public.studio_content_briefs enable row level security;
alter table public.studio_opportunity_corrections enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array[
        'studio_opportunity_decisions',
        'studio_content_briefs',
        'studio_opportunity_corrections'
    ] loop
        execute format('drop policy if exists "service role full access" on public.%I', t);
        execute format(
            'create policy "service role full access" on public.%I for all to service_role using (true) with check (true)',
            t
        );

        execute format('drop policy if exists "members read own org" on public.%I', t);
        execute format($p$
            create policy "members read own org" on public.%I for select to authenticated
            using (
                exists (
                    select 1 from public.organization_memberships m
                    where m.organization_id = %I.organization_id
                      and m.user_id = auth.uid()
                      and m.status = 'active'
                )
            )
        $p$, t, t);

        execute format('drop policy if exists "members insert own org" on public.%I', t);
        execute format($p$
            create policy "members insert own org" on public.%I for insert to authenticated
            with check (
                exists (
                    select 1 from public.organization_memberships m
                    where m.organization_id = %I.organization_id
                      and m.user_id = auth.uid()
                      and m.status = 'active'
                )
            )
        $p$, t, t);

        execute format('drop policy if exists "members update own org" on public.%I', t);
        execute format($p$
            create policy "members update own org" on public.%I for update to authenticated
            using (
                exists (
                    select 1 from public.organization_memberships m
                    where m.organization_id = %I.organization_id
                      and m.user_id = auth.uid()
                      and m.status = 'active'
                )
            ) with check (
                exists (
                    select 1 from public.organization_memberships m
                    where m.organization_id = %I.organization_id
                      and m.user_id = auth.uid()
                      and m.status = 'active'
                )
            )
        $p$, t, t, t);
    end loop;
end $$;

create index if not exists studio_opportunity_decisions_org_idx
    on public.studio_opportunity_decisions (organization_id);
create index if not exists studio_content_briefs_org_idx
    on public.studio_content_briefs (organization_id, created_at desc);
create index if not exists studio_content_briefs_opportunity_idx
    on public.studio_content_briefs (organization_id, source_opportunity_id);
create index if not exists studio_opportunity_corrections_org_idx
    on public.studio_opportunity_corrections (organization_id, opportunity_id);
