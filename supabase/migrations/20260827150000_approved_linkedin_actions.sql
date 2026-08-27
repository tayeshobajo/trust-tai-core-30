-- P2 governed LinkedIn execution: approved_linkedin_actions.
--
-- One row per human-governed LinkedIn action (connection request or message).
-- Core owns the identity linkage (prospect/person/contact); Linki is only the
-- transport and appears solely inside execution_receipt as provenance.
--
-- Lifecycle law enforced by the service layer:
--   pending_tai_approval -> approved (human click)
--   approved -> executing -> executed | failed (terminal)
--   executed -> verified (terminal)
--   Retries are NEW rows referencing the original via parent_action_id.

create table if not exists public.approved_linkedin_actions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    prospect_id uuid not null,
    person_id uuid not null,
    contact_id uuid not null,
    action_type text not null
        constraint approved_linkedin_actions_type_check
        check (action_type in ('connection_request', 'message')),
    draft_body text not null,
    channel_context jsonb not null default '{}'::jsonb,
    status text not null default 'pending_tai_approval'
        constraint approved_linkedin_actions_status_check
        check (status in (
            'pending_tai_approval', 'approved', 'executing',
            'executed', 'failed', 'verified'
        )),
    idempotency_key text not null,
    execution_receipt jsonb,
    failure_reason text,
    created_by uuid not null,
    approved_at timestamptz,
    approved_by uuid,
    executed_at timestamptz,
    parent_action_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint approved_linkedin_actions_idem_uniq unique (organization_id, idempotency_key),
    constraint approved_linkedin_actions_parent_fk
        foreign key (parent_action_id)
        references public.approved_linkedin_actions (id)
);

create index if not exists approved_linkedin_actions_org_idx
    on public.approved_linkedin_actions (organization_id);
create index if not exists approved_linkedin_actions_org_day_idx
    on public.approved_linkedin_actions (organization_id, action_type, created_at);
create index if not exists approved_linkedin_actions_contact_idx
    on public.approved_linkedin_actions (contact_id);

-- RLS: the table is governed by session users through the app; deny the
-- publishable key outright, service role owns administration.
alter table public.approved_linkedin_actions enable row level security;
create policy "service role full access" on public.approved_linkedin_actions
    for all to service_role using (true) with check (true);

-- Workspace members may read and update their own organization's actions.
-- (The human approval boundary lives in the service layer + UI; these
-- policies keep the data organization-scoped at the database level.)
create policy "members read own org actions"
    on public.approved_linkedin_actions for select
    to authenticated
    using (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = approved_linkedin_actions.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    );
create policy "members insert own org actions"
    on public.approved_linkedin_actions for insert
    to authenticated
    with check (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = approved_linkedin_actions.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    );
create policy "members update own org actions"
    on public.approved_linkedin_actions for update
    to authenticated
    using (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = approved_linkedin_actions.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    ) with check (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = approved_linkedin_actions.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    );
