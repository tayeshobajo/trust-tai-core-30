-- PROPOSED, UNAPPLIED. Consistent read-only verification projection.
-- The previous implementation read tasks and ALL receipts in TWO separate
-- PostgREST SELECTs; receipt rows could exceed the PostgREST row cap and
-- be silently truncated while reporting truncated:false, missing a latest
-- reopen and rendering a false verified. This RPC computes the latest
-- receipt per requested task and the task's current revision in ONE
-- statement snapshot, server-side, so partial reads are impossible.
-- Read-only: no writes, no grants here (review script only), RLS on the
-- underlying tables plus the active-membership gate below preserve
-- business visibility. Missing or inaccessible task ids are returned
-- explicitly in `missing` — never silently counted as unverified.

create or replace function public.steward_meeting_verification_projection(
  p_org uuid,
  p_task_ids uuid[]
) returns table(
  task_id uuid,
  status text,
  revision integer,
  latest_kind text,
  latest_revision_after integer,
  verified boolean,
  missing uuid[]
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  requested uuid[];
begin
  if auth.uid() is null or not private.steward_is_active_member(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  requested := coalesce(p_task_ids, '{}'::uuid[]);
  if cardinality(requested) > 100 then
    raise exception 'too_many_tasks' using errcode = 'P0408';
  end if;
  return query
    with req as (
      select unnest(requested) as id
    ),
    visible as (
      -- RLS on steward_tasks applies: only tasks the caller may read
      -- appear here. Requested ids absent from this set are reported in
      -- `missing` rather than treated as unverified.
      select t.id, t.status, t.revision
        from public.steward_tasks t
        join req on req.id = t.id
       where t.organization_id = p_org
    ),
    latest as (
      -- Latest receipt per task in the SAME statement snapshot. Ties on
      -- created_at break by id so ordering is stable and deterministic.
      select distinct on (r.task_id)
             r.task_id, r.kind, r.task_revision_after
        from public.steward_task_receipts r
        join visible v on v.id = r.task_id
       where r.organization_id = p_org
       order by r.task_id, r.created_at desc, r.id desc
    )
    select v.id,
           v.status,
           v.revision,
           l.kind,
           l.task_revision_after,
           -- Same criterion as steward_scope_counts: complete AND the
           -- latest receipt is a verify whose recorded revision still
           -- equals the task's CURRENT revision.
           (v.status = 'complete'
            and l.kind = 'verify'
            and l.task_revision_after = v.revision),
           (select array_agg(req.id) from req
             where not exists (select 1 from visible v2 where v2.id = req.id))
      from visible v
      left join latest l on l.task_id = v.id;
end;
$$;

revoke all on function public.steward_meeting_verification_projection(uuid, uuid[]) from public, anon, authenticated;
