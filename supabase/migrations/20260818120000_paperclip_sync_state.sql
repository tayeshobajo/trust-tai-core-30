-- Paperclip sync state cursor (Phase 6). Tracks reconciliation sweep health
-- per organization + resource. One row per (org, resource_type).
--
-- NOTE: this table was referenced by paperclip-reconcile.server.ts,
-- the edge function, and reconcile-sweep.ts from day one, but the CREATE
-- was never written, smoke #13 passed via a lenient "cache lag" fallback
-- that checked execution_agents instead. This migration closes that gap.

create table if not exists public.paperclip_sync_state (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    resource_type text not null default 'agents',
    last_success_at timestamptz,
    last_error text,
    last_cursor text,
    consecutive_failures integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint paperclip_sync_state_org_resource_uniq unique (organization_id, resource_type)
);

-- Service role (Trust Tai backend + reconcile sweeps) owns this table.
alter table public.paperclip_sync_state enable row level security;
create policy "service role full access" on public.paperclip_sync_state
    for all to service_role using (true) with check (true);

create index if not exists paperclip_sync_state_org_idx
    on public.paperclip_sync_state (organization_id);
