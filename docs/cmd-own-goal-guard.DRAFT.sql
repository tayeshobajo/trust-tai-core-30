-- REVIEW ONLY. Not an applied migration. No automatic migration-directory entry.
-- Narrow protection for own-goal confirmation without changing shared work access.
-- Test in isolated PostgreSQL first, including authenticated member/admin,
-- anonymous, service role and existing proposal/reconcile flows.
begin;

create or replace function public.cmd_guard_weekly_goal_confirmation()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Trusted backend workflows remain governed by their server authorization.
  if auth.role() = 'service_role' then return new; end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if TG_OP = 'INSERT' then
    if new.status = 'confirmed' or new.confirmed_at is not null then
      raise exception 'Create a proposal before confirming a goal';
    end if;
  else
    if new.owner_user_id is distinct from old.owner_user_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'Goal ownership and workspace cannot be changed';
    end if;
    if new.status is distinct from old.status
       or new.confirmed_at is distinct from old.confirmed_at then
      if old.owner_user_id is distinct from auth.uid() then
        raise exception 'Only the goal owner can change its confirmation';
      end if;
      if new.status = 'confirmed' and old.status <> 'proposed' then
        raise exception 'Only a proposed goal can be confirmed';
      end if;
      if new.status = 'confirmed' then new.confirmed_at := now(); end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger cmd_guard_weekly_goal_confirmation
before insert or update on public.steward_weekly_goals
for each row execute function public.cmd_guard_weekly_goal_confirmation();

commit;
