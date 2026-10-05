-- REVIEW ONLY. Not an applied migration. No automatic migration-directory entry.
-- Narrow protection for own-goal confirmation without changing shared work access.
-- Test in isolated PostgreSQL first, including authenticated member/admin,
-- anonymous, service role and existing proposal/reconcile flows.
begin;

create or replace function public.cmd_guard_weekly_goal_confirmation()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A backend may propose a goal but cannot impersonate its human confirmer.
  if auth.uid() is null and auth.role() is distinct from 'service_role' then raise exception 'Authentication required'; end if;

  if TG_OP = 'INSERT' then
    if new.status <> 'proposed' or new.confirmed_at is not null or new.completed_at is not null then
      raise exception 'Create a proposal before confirming a goal';
    end if;
  else
    if new.id is distinct from old.id or new.owner_user_id is distinct from old.owner_user_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'Goal ownership and workspace cannot be changed';
    end if;
    -- A confirmation applies to this exact outcome, not later substituted text.
    if (old.confirmed_at is not null or old.status in ('confirmed','complete'))
       and new.status <> 'proposed'
       and (new.title is distinct from old.title or new.linked_task_ids is distinct from old.linked_task_ids
         or new.target_count is distinct from old.target_count or new.week_start is distinct from old.week_start
         or new.notes is distinct from old.notes) then
      raise exception 'Reopen the goal as a proposal before changing the confirmed outcome';
    end if;
    if new.status is distinct from old.status
       or new.confirmed_at is distinct from old.confirmed_at
       or new.completed_at is distinct from old.completed_at then
      if auth.uid() is null or old.owner_user_id is distinct from auth.uid() then
        raise exception 'Only the goal owner can change its confirmation';
      end if;
      if new.status = 'confirmed' and old.status <> 'proposed' then
        raise exception 'Only a proposed goal can be confirmed';
      end if;
      if new.status = 'complete' and old.status <> 'confirmed' then raise exception 'Confirm a goal before completing it'; end if;
      if new.status = 'confirmed' then new.confirmed_at := now(); else new.confirmed_at := old.confirmed_at; end if;
      if new.status = 'complete' then new.completed_at := now(); else new.completed_at := old.completed_at; end if;
      if new.status = 'proposed' then new.confirmed_at := null; new.completed_at := null; end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger cmd_guard_weekly_goal_confirmation
before insert or update on public.steward_weekly_goals
for each row execute function public.cmd_guard_weekly_goal_confirmation();

revoke all on function public.cmd_guard_weekly_goal_confirmation() from public, anon, authenticated;

commit;
