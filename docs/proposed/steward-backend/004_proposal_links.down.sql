-- Rollback for 004_proposal_links.up.sql (PROPOSED, UNAPPLIED).
drop function if exists steward_link_proposal(uuid,uuid,uuid,uuid,uuid,uuid);
drop table if exists steward_proposal_links;
