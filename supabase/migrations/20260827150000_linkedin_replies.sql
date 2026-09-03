-- P3 reply ingestion: LinkedInReplyObserved landing table.
--
-- One person. One memory. Many channels. Linki observes raw LinkedIn replies
-- (transport); Core resolves the sender onto the ONE canonical contact and the
-- ONE Comms relationship. There is no Linki-side identity here, only a
-- resolution ledger whose success state points at canonical rows.
--
-- Governing laws (linki-integration brief + P3 contract doc):
--   * Ingestion NEVER auto-creates a contact. An unmatched sender lands in
--     status='pending_resolution' for a human. Never a guess.
--   * Resolution is by the linkedin_url provenance written at P1.10 confirm
--     time (contacts.metadata.linkedin_url where linkedin_confirmed = true).
--     If more than one contact matches, that is ambiguity -> human queue too.
--   * A reply feeds Comms relationship context only. It never triggers an
--     auto-reply, sequence, or any outbound action.
--   * The dedupe key (source + external_message_ref) is unique: Linki may
--     redeliver the same observed reply and Core absorbs it as a no-op.
--
-- Applied manually via Supabase (SQL editor or supabase db push). This file
-- is the source of truth; it is NOT applied by this code change.

create table if not exists public.linkedin_replies (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,

    -- Transport provenance (Linki only)
    source text not null default 'linki',
    external_thread_ref text not null,
    external_message_ref text not null,

    -- Sender, as observed on the wire. Provenance only. NEVER identity.
    sender_linkedin_url text,
    sender_external_id text,
    sender_name text,

    -- The observed reply. Truncated for display; full text may live in
    -- payload if a caller chooses to keep it.
    body text not null,

    -- Account that observed the reply (LinkedIn account in Linki).
    account_ref text,

    observed_at timestamptz not null,

    -- Resolution ledger
    status text not null default 'pending_resolution'
        constraint linkedin_replies_status_check
        check (status in ('pending_resolution', 'resolved', 'rejected')),
    resolved_contact_id uuid references public.contacts(id) on delete set null,
    relationship_id uuid references public.comms_relationships(id) on delete set null,
    resolution_note text,
    resolved_at timestamptz,
    resolved_by uuid,

    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Redelivery of the same observed reply is absorbed, never duplicated.
    constraint linkedin_replies_dedupe_uniq unique (source, external_message_ref)
);

create index if not exists linkedin_replies_org_status_idx
    on public.linkedin_replies (organization_id, status);

create index if not exists linkedin_replies_pending_queue_idx
    on public.linkedin_replies (organization_id, created_at)
    where status = 'pending_resolution';

create index if not exists linkedin_replies_relationship_idx
    on public.linkedin_replies (relationship_id)
    where relationship_id is not null;

create index if not exists linkedin_replies_sender_url_idx
    on public.linkedin_replies (sender_linkedin_url)
    where sender_linkedin_url is not null;

-- Ingestion is server-only (service role / governed server routes).
alter table public.linkedin_replies enable row level security;
create policy "service role full access" on public.linkedin_replies
    for all to service_role using (true) with check (true);

-- Members may READ the human-resolution queue and resolved history for their
-- organization; writes stay server-only.
create policy "members read own org" on public.linkedin_replies
    for select to authenticated using (
        exists (
            select 1 from public.organization_memberships om
            where om.organization_id = linkedin_replies.organization_id
              and om.user_id = auth.uid()
        )
    );
