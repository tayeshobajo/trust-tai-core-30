-- PROPOSED, UNAPPLIED rollback for 007_verification_projection.
-- Read-only function; dropping it preserves all history (no data touched).
drop function if exists public.steward_meeting_verification_projection(uuid, uuid[]);
