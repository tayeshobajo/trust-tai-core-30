-- Data-preserving operational rollback for 004_proposal_links.
drop function if exists public.steward_link_proposal(uuid, uuid, uuid, uuid, uuid);
drop trigger if exists steward_proposal_links_immutable on public.steward_proposal_links;
drop policy if exists steward_proposal_links_select on public.steward_proposal_links;
alter table public.steward_proposal_links disable row level security;
