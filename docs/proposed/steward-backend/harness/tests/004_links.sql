-- Proposal links: canonical ledger identity, existence validation,
-- idempotency, scope invalidation. The ledger mirrors the real extraction
-- contract (source_key, like commitments.source_key). Registration runs
-- through steward_register_proposals as an authenticated writer with the
-- EXACT transcript the extraction read; the org-B row is seeded as
-- service_role since no org-B actor ever registers it.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare added integer;
begin
  added := public.steward_register_proposals(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c0000000-0000-0000-0000-000000000001',
    '[{"source_key":"ext-3948","kind":"action","statement":"Roadmap proposal at 39:48"},
      {"source_key":"ext-5357","kind":"action","statement":"Mockup proposal at 53:57"}]'::jsonb,
    '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb);
  perform public.test_assert(added = 2, 'registration adds both proposals');
  -- Idempotent re-extraction of the same transcript: nothing new, and a
  -- human decision taken later is never reset by re-registration.
  added := public.steward_register_proposals(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c0000000-0000-0000-0000-000000000002',
    '[{"source_key":"ext-3948","kind":"action","statement":"Roadmap proposal at 39:48"},
      {"source_key":"ext-5357","kind":"action","statement":"Mockup proposal at 53:57"}]'::jsonb,
    '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb);
  perform public.test_assert(added = 0, 're-extraction is idempotent');
end $$;
-- Stale extraction: transcript the caller read no longer matches stored.
select public.test_denied($q$
  select public.steward_register_proposals(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c0000000-0000-0000-0000-000000000003',
    '[{"source_key":"ext-stale","kind":"action","statement":"stale"}]'::jsonb,
    '{"segments":[{"speaker":"Tai","text":"Older transcript.","offset":0}]}'::jsonb) $q$,
  'stale transcript registration rejected');
-- Registration requires write authority.
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_register_proposals(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c0000000-0000-0000-0000-000000000004',
    '[]'::jsonb,
    '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb) $q$,
  'viewer cannot register proposals');
-- Pin the registered rows to stable fixture IDs for the link tests below.
set role service_role;
select public.test_act_as_worker();
update public.steward_proposal_ledger set id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
 where organization_id = '11111111-1111-1111-1111-111111111111' and source_key = 'ext-3948';
update public.steward_proposal_ledger set id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
 where organization_id = '11111111-1111-1111-1111-111111111111' and source_key = 'ext-5357';
insert into public.steward_proposal_ledger
  (id, organization_id, conversation_id, source_key, kind, statement) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee001', '22222222-2222-2222-2222-222222222222',
   'dddddddd-dddd-dddd-dddd-dddddddddd01', 'ext-b1', 'action', 'Org B proposal');
reset role;

-- 0. Baseline: attest coverage so the link's invalidation is observable.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
begin
  perform public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c4000000-0000-0000-0000-000000000000',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    coalesce((select version from public.steward_scope_versions
      where organization_id = '11111111-1111-1111-1111-111111111111'
        and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'), 1));
  perform public.test_assert(
    public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'coverage valid before link');
end $$;

-- 1. Link happy path: explicit human decision, no task/commitment created,
--    ledger status flips to linked, coverage invalidated in-transaction.
do $$
declare l public.steward_proposal_links; n integer; v integer; s text;
begin
  select count(*) into n from public.steward_tasks
   where organization_id = '11111111-1111-1111-1111-111111111111';
  l := public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');
  perform public.test_assert(l.actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'link actor from auth.uid');
  perform public.test_assert((select count(*) from public.steward_tasks
    where organization_id = '11111111-1111-1111-1111-111111111111') = n, 'linking never creates a task');
  select status into s from public.steward_proposal_ledger where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  perform public.test_assert(s = 'linked', 'ledger proposal marked linked');
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'link supersedes coverage');
  select version into v from public.steward_scope_versions
   where organization_id = '11111111-1111-1111-1111-111111111111'
     and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  perform public.test_assert(v >= 3, 'link durably bumps scope version');
  -- The link atomically adds the confirmed task to the required-scope
  -- denominator in the same transaction, with an audit row.
  perform public.test_assert(exists(
    select 1 from public.steward_scope_items si
     where si.organization_id = '11111111-1111-1111-1111-111111111111'
       and si.conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
       and si.task_id = '10000000-0000-0000-0000-000000000001'
       and si.classification = 'transcript'
       and si.removed_at is null),
    'link atomically adds the task to required scope');
  perform public.test_assert(exists(
    select 1 from public.steward_scope_audit sa
     where sa.organization_id = '11111111-1111-1111-1111-111111111111'
       and sa.operation_id = 'c1000000-0000-0000-0000-000000000001'
       and sa.kind = 'add'),
    'link scope addition is audited');
end $$;

-- 2. Same operation replays; different operation on linked proposal
--    conflicts; reused UUID with changed payload conflicts.
do $$
declare l public.steward_proposal_links;
begin
  l := public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');
  perform public.test_assert(l.id is not null, 'same operation replays link');
end $$;
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '10000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002') $q$,
  'second link of same proposal conflicts');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001') $q$,
  'reused operation UUID with changed payload conflicts');

-- 3. Existence: proposal from another conversation/org and unknown task
--    rejected; personal tasks out of scope.
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeee001',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003') $q$,
  'cross-org proposal rejected');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000099', 'c1000000-0000-0000-0000-000000000004') $q$,
  'unknown task rejected');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000005') $q$,
  'personal task link rejected');

-- 4. Authority: member cannot link to the owner's task; viewer/inactive
--    cannot link at all.
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001') $q$,
  'member cannot link to another user task');
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002') $q$,
  'viewer cannot link');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000003') $q$,
  'inactive cannot link');

-- 5. Links are immutable; direct writes denied.
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  insert into public.steward_proposal_links
    (organization_id, conversation_id, proposal_ledger_id, task_id, operation_id, request_digest, actor_id)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'ffffffff-ffff-ffff-ffff-ffffffffffff', '10000000-0000-0000-0000-000000000001',
    gen_random_uuid(), 'forged', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$,
  'direct link insert denied');
reset role;
select public.test_denied($q$
  delete from public.steward_proposal_links where true $q$, 'link delete blocked by trigger');

-- 6. Explicit human dismissal: substantive reason required, idempotent
--    replay, scope invalidated, linked proposals cannot be dismissed.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  select public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'no', 'c3000000-0000-0000-0000-000000000001') $q$,
  'thin dismissal reason rejected');
do $$
declare p public.steward_proposal_ledger; v integer;
begin
  p := public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Reviewed: covered by the existing roadmap task.', 'c3000000-0000-0000-0000-000000000002');
  perform public.test_assert(p.status = 'dismissed', 'proposal dismissed by human');
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'dismissal invalidates coverage');
  -- Idempotent replay: same row returned, no error, no duplicate event.
  p := public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Reviewed: covered by the existing roadmap task.', 'c3000000-0000-0000-0000-000000000003');
  perform public.test_assert(p.status = 'dismissed', 'dismissal replay is idempotent');
  select version into v from public.steward_scope_versions
   where organization_id = '11111111-1111-1111-1111-111111111111'
     and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  perform public.test_assert(v >= 4, 'dismissal durably bumps scope version');

  -- Decision audit: the dismissal persisted reason, actor, operation and
  -- digest; the SAME operation replays; a changed payload conflicts.
  perform public.test_assert(exists(
    select 1 from public.steward_proposal_decisions d
     where d.organization_id = '11111111-1111-1111-1111-111111111111'
       and d.operation_id = 'c3000000-0000-0000-0000-000000000002'
       and d.kind = 'dismiss'
       and d.reason = 'Reviewed: covered by the existing roadmap task.'
       and d.actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'dismissal decision persisted with reason, actor and operation');
  p := public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Reviewed: covered by the existing roadmap task.', 'c3000000-0000-0000-0000-000000000002');
  perform public.test_assert(p.status = 'dismissed', 'same dismissal operation replays');
  begin
    perform public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
      'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'A DIFFERENT reason on the same operation.', 'c3000000-0000-0000-0000-000000000002');
    raise exception 'FAILED: changed dismissal payload accepted';
  exception when sqlstate 'P0002' then
    perform public.test_assert(true, 'changed dismissal payload conflicts');
  end;
  -- Registration recorded its operation too; replaying it adds nothing.
  perform public.test_assert(exists(
    select 1 from public.steward_proposal_decisions d
     where d.organization_id = '11111111-1111-1111-1111-111111111111'
       and d.kind = 'register'), 'registration decision persisted');
end $$;
select public.test_denied($q$
  select public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'Trying to dismiss a linked proposal.', 'c3000000-0000-0000-0000-000000000004') $q$,
  'linked proposal cannot be dismissed');
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeee001',
    'Viewer attempting a dismissal here.', 'c3000000-0000-0000-0000-000000000005') $q$,
  'viewer cannot dismiss');
reset role;

-- 7. Adversarial: a dismissed proposal can never be silently overwritten
--    by a later link; the human dismissal stands.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000010') $q$,
  'linking a dismissed proposal is rejected, never an overwrite');
do $$
begin
  perform public.test_assert((select status from public.steward_proposal_ledger
    where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff') = 'dismissed',
    'dismissed status survives the rejected link');
end $$;

-- 8. Adversarial: linking to a task whose scope item was explicitly
--    REMOVED fails closed — the proposal is never marked linked while its
--    obligation would stay out of the denominator. Reinstatement needs
--    its own explicit audited amendment.
do $$
declare added integer;
begin
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000006',
    'manual_required', 'd4000000-0000-0000-0000-000000000001');
  perform public.steward_scope_amend_remove('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    (select id from public.steward_scope_items
      where organization_id = '11111111-1111-1111-1111-111111111111'
        and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
        and task_id = '10000000-0000-0000-0000-000000000006'),
    'Reviewed: obligation withdrawn by the meeting owner.', 'd4000000-0000-0000-0000-000000000002');
  added := public.steward_register_proposals(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c4000000-0000-0000-0000-000000000011',
    '[{"source_key":"ext-7701","kind":"action","statement":"Removed-scope link probe"}]'::jsonb,
    '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb);
  perform public.test_assert(added = 1, 'probe proposal registered');
end $$;
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    (select id from public.steward_proposal_ledger
      where organization_id = '11111111-1111-1111-1111-111111111111'
        and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
        and source_key = 'ext-7701'),
    '10000000-0000-0000-0000-000000000006', 'c4000000-0000-0000-0000-000000000012') $q$,
  'link into a removed scope item fails closed');
do $$
begin
  perform public.test_assert((select status from public.steward_proposal_ledger
    where organization_id = '11111111-1111-1111-1111-111111111111'
      and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      and source_key = 'ext-7701') = 'proposed',
    'rejected link leaves the proposal pending — no silent gate removal');
  perform public.test_assert((select removed_at is not null from public.steward_scope_items
    where organization_id = '11111111-1111-1111-1111-111111111111'
      and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      and task_id = '10000000-0000-0000-0000-000000000006'),
    'removed scope item stays removed after the rejected link');
end $$;
reset role;
