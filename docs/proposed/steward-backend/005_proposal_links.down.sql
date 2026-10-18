-- Data-preserving operational rollback for 004_proposal_links.
-- Drops the decision functions ONLY. Links, the proposal ledger, the
-- decision audit, RLS, select
-- policies and the immutability/invalidation triggers are KEPT, so
-- retained history stays org-scoped and immutable after rollback.
drop function if exists public.steward_link_proposal(uuid, uuid, uuid, uuid, uuid);
drop function if exists public.steward_register_proposals(uuid, uuid, uuid, jsonb, jsonb);
drop function if exists public.steward_dismiss_proposal(uuid, uuid, uuid, text, uuid);
