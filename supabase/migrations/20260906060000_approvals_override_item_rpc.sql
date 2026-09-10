-- Trust Tai OS. Accepting one flagged item, atomically.
--
-- Applied to the managed Trust Tai Supabase project (ref okydosoacqdnursmmenf).
-- Additive and idempotent: safe to run more than once.
--
-- Why this exists. The client used to move `approval_items.state` and then
-- append the decision to `approval_events` as two separate statements. When the
-- second statement failed, one article stayed approved with no record of who
-- accepted it or why, which breaks the verification law: no approved work
-- without its audit event.
--
-- Security. SECURITY INVOKER, so the signed-in caller's RLS on both tables
-- still governs every row this touches. There is no service-role path for a
-- human decision. The function only ever moves an item that is currently in
-- `exception`, and it writes the canonical `decision` kind narrowed by
-- `metadata.scope = 'item_override'`, so `approval_events_kind_check` is
-- unchanged.

create or replace function public.approvals_override_item(
  p_organization_id uuid,
  p_request_id text,
  p_item_id text,
  p_reason text,
  p_actor jsonb,
  p_event_id text,
  p_body text,
  p_metadata jsonb,
  p_at timestamptz
)
returns public.approval_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated public.approval_items;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'An override needs a reason.';
  end if;

  update public.approval_items
     set state = 'approved',
         facts = coalesce(facts, '{}'::jsonb) || jsonb_build_object(
           'override', jsonb_build_object(
             'itemId', p_item_id,
             'reason', btrim(p_reason),
             'by', p_actor,
             'at', p_at
           )
         ),
         updated_at = p_at
   where organization_id = p_organization_id
     and request_id = p_request_id
     and id = p_item_id
     and state = 'exception'
  returning * into updated;

  if updated.id is null then
    raise exception 'That item is not waiting for you any more.';
  end if;

  -- Same transaction: the decision and its record stand or fall together.
  insert into public.approval_events
    (id, organization_id, request_id, kind, body, actor, metadata, created_at)
  values
    (p_event_id, p_organization_id, p_request_id, 'decision', p_body, p_actor,
     coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('scope', 'item_override'), p_at);

  return updated;
end
$$;

revoke all on function public.approvals_override_item(
  uuid, text, text, text, jsonb, text, text, jsonb, timestamptz) from public, anon;

grant execute on function public.approvals_override_item(
  uuid, text, text, text, jsonb, text, text, jsonb, timestamptz) to authenticated;
