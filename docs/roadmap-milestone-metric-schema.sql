-- Trust Tai OS, P3-01: milestone outcome metric.
--
-- Additive, idempotent, RLS compatible. It adds one nullable jsonb column to
-- the existing roadmap_milestones table. No new table, no new policy, no
-- backfill: a milestone without a metric keeps NULL, which the application
-- reads as honest absence, never zero.
--
-- Shape stored in the column (written only by the Roadmap service):
--   {
--     "key": "demo_to_close_rate",
--     "label": "Demo to close rate",
--     "unit": "%",
--     "direction": "increase" | "decrease" | "maintain",
--     "baseline": { "value": 12, "at": "2026-09-01" },
--     "target":   { "value": 25, "at": "2026-12-01" },
--     "tier": "decided",
--     "recordedBy": "<user uuid>",
--     "recordedAt": "<iso timestamp>"
--   }

alter table public.roadmap_milestones
  add column if not exists outcome_metric jsonb;

comment on column public.roadmap_milestones.outcome_metric is
  'P3-01 outcome metric: key, label, unit, direction, baseline{value,at}, target{value,at}, plus decided-tier provenance. NULL means no metric has been recorded.';

-- Structural guard only. Value law (direction against the numbers, target date
-- not before the baseline date) is enforced in the domain, which can explain
-- its refusal to a person.
alter table public.roadmap_milestones
  drop constraint if exists roadmap_milestones_outcome_metric_shape;

alter table public.roadmap_milestones
  add constraint roadmap_milestones_outcome_metric_shape check (
    outcome_metric is null
    or (
      jsonb_typeof(outcome_metric) = 'object'
      and outcome_metric ? 'key'
      and outcome_metric ? 'label'
      and outcome_metric ? 'unit'
      and outcome_metric ->> 'direction' in ('increase', 'decrease', 'maintain')
      and jsonb_typeof(outcome_metric -> 'baseline') = 'object'
      and jsonb_typeof(outcome_metric -> 'target') = 'object'
    )
  );

-- Existing table grants and RLS policies already cover this column; nothing
-- here widens access.
