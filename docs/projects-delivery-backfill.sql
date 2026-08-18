-- Trust Tai OS — Projects delivery backfill.
--
-- Run AFTER docs/projects-delivery-schema.sql, against project okydosoacqdnursmmenf.
-- Idempotent: safe to run more than once.
--
-- This does not invent delivery data. Every row below is derived from truth the
-- project already carries in `public.projects.metadata`:
--
--   metadata->>'next_move'        → the first work item, because that is what a
--                                   person already said comes next
--   metadata->>'point_b'          → a review item, the agreed outcome to check against
--   metadata->>'blocked_because'  → an open blocker, when the project is blocked
--
-- Roadmap truth is untouched: nothing here writes to roadmap_* tables.
-- Files are deliberately not backfilled — a file row without a real object in the
-- private `project-files` bucket would break Open and Download. Upload real files
-- from the Files tab instead.

/* ---------------------------------------------- work item 1: the next move */

insert into public.project_work_items (
  organization_id, project_id, title, description, status, sequence,
  milestone_id, created_by, started_at
)
select
  p.organization_id,
  p.id,
  coalesce(nullif(p.metadata->>'next_move', ''), 'Agree the first delivery step'),
  'Backfilled from the next move already recorded on this project.',
  case when p.metadata->>'execution_state' in ('in_flight', 'in_review') then 'in_progress'
       when p.metadata->>'execution_state' = 'blocked' then 'blocked'
       else 'ready' end,
  0,
  nullif(p.metadata->'origin'->>'milestoneId', '')::uuid,
  p.created_by,
  case when p.metadata->>'execution_state' in ('in_flight', 'in_review') then p.created_at end
from public.projects p
where not exists (
  select 1 from public.project_work_items w where w.project_id = p.id
);

/* --------------------------------------- work item 2: prove the outcome */

insert into public.project_work_items (
  organization_id, project_id, title, description, status, sequence,
  milestone_id, created_by
)
select
  p.organization_id,
  p.id,
  'Review against: ' || nullif(p.metadata->>'point_b', ''),
  'Backfilled from the agreed outcome (point B) on this project.',
  'ready',
  1,
  nullif(p.metadata->'origin'->>'milestoneId', '')::uuid,
  p.created_by
from public.projects p
where nullif(p.metadata->>'point_b', '') is not null
  and not exists (
    select 1 from public.project_work_items w
    where w.project_id = p.id and w.sequence = 1
  );

/* --------------------------------------------- blockers: only real ones */

insert into public.project_blockers (
  organization_id, project_id, work_item_id, reason, impact, next_move,
  status, raised_at, created_by
)
select
  p.organization_id,
  p.id,
  (select w.id from public.project_work_items w
    where w.project_id = p.id order by w.sequence limit 1),
  p.metadata->>'blocked_because',
  'This milestone is not moving while the block stands.',
  nullif(p.metadata->>'next_move', ''),
  'open',
  coalesce((p.metadata->>'last_moved_at')::timestamptz, p.updated_at),
  p.created_by
from public.projects p
where nullif(p.metadata->>'blocked_because', '') is not null
  and not exists (
    select 1 from public.project_blockers b
    where b.project_id = p.id and b.reason = p.metadata->>'blocked_because'
  );

/* ------------------------------------------- decisions: only real gaps */
-- A project sitting in `waiting` is waiting on a person. That is a delivery
-- decision the room should show, and it is derived, not invented.

insert into public.project_decisions (
  organization_id, project_id, work_item_id, question, why_it_matters,
  status, created_by, created_at
)
select
  p.organization_id,
  p.id,
  (select w.id from public.project_work_items w
    where w.project_id = p.id order by w.sequence limit 1),
  'What do we need from the client before ' || coalesce(nullif(p.metadata->>'next_move', ''), p.name) || '?',
  'This project is waiting, so delivery cannot continue until someone answers.',
  'open',
  p.created_by,
  coalesce((p.metadata->>'last_moved_at')::timestamptz, p.updated_at)
from public.projects p
where p.metadata->>'execution_state' = 'waiting'
  and not exists (
    select 1 from public.project_decisions d where d.project_id = p.id
  );
