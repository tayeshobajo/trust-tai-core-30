-- PROPOSED, NOT APPLIED. For Codex review.
--
-- One additive column. The reviewer already returns private notes about
-- possible future work; without somewhere to put them they are shown once and
-- lost on reload, and the run cannot say whether "no notes" means none were
-- raised or none were kept. Nothing else changes: no grants, no policies, no
-- data, no existing column touched.
--
-- Shape of each element:
--   {"evidence": "...", "reading": "...", "worth": "...", "timing": "..."}
-- Evidence is quoted from the source material, checked in application code
-- before the row is written.

ALTER TABLE public.comms_review_runs
  ADD COLUMN IF NOT EXISTS opportunities jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.comms_review_runs.opportunities IS
  'Private notes to the author about possible future work. Never part of an outbound message. Empty array means none were raised by this run.';
