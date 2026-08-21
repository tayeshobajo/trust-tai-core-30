-- Provenance on pattern outcomes.
--
-- An outcome can now be established three ways: a person recorded it, an exact
-- canonical room event confirmed it, or the current canonical state confirmed
-- it through an existing deterministic check. Nothing else changes: rows stay
-- append only, and no room state is copied into the ledger.
--
-- Additive and safe to re-run. Existing rows read as human recorded, which is
-- what they were.

alter table public.pattern_outcomes
  add column if not exists result_source text not null default 'human'
    check (result_source in ('human', 'room_event', 'current_state')),
  add column if not exists source_refs jsonb not null default '[]'::jsonb,
  add column if not exists observed_at timestamptz;

create index if not exists pattern_outcomes_source_idx
  on public.pattern_outcomes (organization_id, result_source, recorded_at desc);

-- Grants are unchanged: select and insert for members, all for service_role.
