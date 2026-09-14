-- PROPOSED — for Codex review. Not applied by the app, and the app does not
-- require it: every write below is attempted and falls back cleanly (42703)
-- when the column is absent, in which case the screen says the kind was not
-- recorded rather than implying it was.
--
-- Purpose: record what a review is a review of — a message, an email or a
-- proposal — and, for proposals, the structure the text was rendered from, so
-- an audit can reconstruct the exact reviewed words from the same source.
--
-- Additive only. No existing column, constraint, policy, grant or trigger is
-- changed. No data is rewritten. Existing rows read as "kind not recorded".

alter table public.comms_review_sessions
  add column if not exists kind text;

alter table public.comms_review_sessions
  drop constraint if exists comms_review_sessions_kind_chk;
alter table public.comms_review_sessions
  add constraint comms_review_sessions_kind_chk
  check (kind is null or kind in ('message', 'email', 'proposal'));

-- The structured source a proposal's words were rendered from. Immutable in
-- practice: a change to the sections produces a new version through the
-- existing version path, exactly like any other edit.
alter table public.comms_review_versions
  add column if not exists structured_source jsonb;

-- Nothing else is needed: reads are covered by the existing organization
-- scoped SELECT policies, writes by the existing verified service path, and
-- the existing triggers already bump context_revision when a version is
-- added, so a changed proposal invalidates an approval exactly as today.
