-- Data-preserving rollback for 006_meeting_score_snapshot.up.sql.
-- The snapshot function is read-only and stores nothing, so dropping it
-- loses no history. Scope counts, coverage attestations and ledger rows
-- from earlier patches are untouched.

drop function if exists public.steward_meeting_score_snapshot(uuid, uuid);
