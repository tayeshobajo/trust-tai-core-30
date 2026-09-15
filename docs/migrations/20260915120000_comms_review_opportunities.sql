-- APPLIED 2026-09-15 by Codex with Tai's explicit approval of Revision 2 (migration name: comms_review_opportunities_nullable).
--
-- Verification after apply: opportunities jsonb nullable, default null; array-shape constraint present; one historical run retains NULL; original-record digest unchanged (0773ed95b95a1259255afbd365cfb1f9); RLS still enabled; authenticated UPDATE still denied. Do not reapply.
-- One additive, nullable column. The reviewer already returns private notes
-- about possible future work; without somewhere to put them they are shown
-- once and lost on reload.
--
-- Revision 2 exists because revision 1 used NOT NULL DEFAULT '[]'::jsonb.
-- That default would have written an empty array onto every historical run,
-- which reads as "this run raised no notes" when the truth is "this run never
-- had anywhere to record them". Three states must stay distinguishable:
--
--   NULL  -> not recorded. The run predates the column, or the write failed.
--   '[]'  -> recorded, and this run raised nothing.
--   [...] -> recorded notes.
--
-- Nothing else changes: no grants, no policies, no data backfill, no existing
-- column touched, no change to run immutability or RLS. Existing policies on
-- comms_review_runs continue to govern who may read or write the row; this
-- column is written only by the same completion update that closes a run.
--
-- Shape of each element:
--   {"evidence": "...", "reading": "...", "worth": "...", "timing": "..."}
-- Evidence is quoted from the source material, checked in application code
-- before the row is written.

ALTER TABLE public.comms_review_runs
  ADD COLUMN IF NOT EXISTS opportunities jsonb;

-- Shape only: NULL stays allowed and means "not recorded"; anything present
-- must be a JSON array so a reader can never mistake an object or a string
-- for a list of notes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.comms_review_runs'::regclass
      AND conname = 'comms_review_runs_opportunities_is_array'
  ) THEN
    ALTER TABLE public.comms_review_runs
      ADD CONSTRAINT comms_review_runs_opportunities_is_array
      CHECK (opportunities IS NULL OR jsonb_typeof(opportunities) = 'array');
  END IF;
END
$$;

COMMENT ON COLUMN public.comms_review_runs.opportunities IS
  'Private notes to the author about possible future work. Never part of an outbound message. NULL means this run did not record them (historical run, or the write failed). An empty array means the run completed and raised none.';
