-- Retain original uncertain request and consume a separate one-shot recovery claim.
-- Existing table RLS and service-role-only writes remain unchanged.
ALTER TABLE public.studio_research_requests
  ADD COLUMN intake_recovery_authorization jsonb,
  ADD COLUMN intake_recovery_receipt jsonb;
ALTER TABLE public.studio_research_requests
  ADD CONSTRAINT studio_intake_recovery_authorization_object CHECK (intake_recovery_authorization IS NULL OR jsonb_typeof(intake_recovery_authorization) = 'object'),
  ADD CONSTRAINT studio_intake_recovery_receipt_object CHECK (intake_recovery_receipt IS NULL OR jsonb_typeof(intake_recovery_receipt) = 'object');
