-- Verification projection RPC: one-statement snapshot, latest receipt per
-- task, no silent truncation, explicit missing ids, stable tie ordering.
-- 1. Bulk receipts far beyond the PostgREST 1000-row cap on ONE task:
--    1200 verify receipts then a FINAL reopen. The projection must see
--    the reopen (false), proving no row-cap truncation hides it.
do $$
declare
  i int;
begin
  for i in 1..1200 loop
    insert into public.steward_task_receipts
      (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id, created_at)
    values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000005',
      gen_random_uuid(), 'verify', 'bulk receipt', 'digest-' || i, 1,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - (interval '1 second' * (1300 - i)));
  end loop;
  insert into public.steward_task_receipts
    (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id, created_at)
  values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000005',
    gen_random_uuid(), 'reopen', 'final reopen after bulk verifies', 'digest-final', 1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());
end $$;
update public.steward_tasks set status = 'complete' where id = '10000000-0000-0000-0000-000000000005';
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare r record;
begin
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005']::uuid[]);
  perform public.test_assert(r.latest_kind = 'reopen' and r.verified = false,
    'latest reopen wins over 1200 earlier verifies — no truncation');
end $$;

-- 2. Same-timestamp tie: two receipts with identical created_at; the
--    reopen (inserted second, higher id) must win deterministically.
reset role;
do $$
declare
  t timestamptz := now();
begin
  insert into public.steward_task_receipts
    (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id, created_at)
  values
    ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000006',
     gen_random_uuid(), 'verify', 'tie verify', 'tie-a', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', t),
    ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000006',
     gen_random_uuid(), 'reopen', 'tie reopen', 'tie-b', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', t);
end $$;
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare r record;
begin
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000006']::uuid[]);
  perform public.test_assert(r.latest_kind = 'reopen',
    'same-timestamp tie breaks deterministically by id');
end $$;

-- 3. Valid current verify: revision-bound credit when the latest verify
--    receipt's task_revision_after equals the CURRENT revision.
reset role;
update public.steward_tasks set status = 'complete', revision = 7
 where id = '10000000-0000-0000-0000-000000000003';
insert into public.steward_task_receipts
  (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id)
values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000003',
  gen_random_uuid(), 'verify', 'current valid verify', 'digest-cur', 7,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare r record;
begin
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000003']::uuid[]);
  perform public.test_assert(r.verified = true, 'current valid verify earns credit');
  -- A later edit (revision bump) drops the credit in the SAME projection.
  reset role;
  update public.steward_tasks set revision = 8 where id = '10000000-0000-0000-0000-000000000003';
  set role authenticated;
  perform public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000003']::uuid[]);
  perform public.test_assert(r.verified = false, 'post-verify edit drops credit');
end $$;

-- 4. Legacy complete with NO receipt: never verified. A FRESH task —
--    earlier suites may have given the shared fixtures receipts.
reset role;
insert into public.steward_tasks
  (id, organization_id, title, notes, correlation_id, task_visibility, owner_user_id, created_by, status, archived_at)
values ('10000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
  'Legacy complete probe', 'Complete with no receipt at all.', null, 'business',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'complete', null);
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare r record;
begin
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-00000000000c']::uuid[]);
  perform public.test_assert(r.verified = false and r.latest_kind is null,
    'legacy complete without a receipt is not verified');
end $$;

-- 5. Missing and cross-org ids come back in `missing`, never as false.
do $$
declare r record;
begin
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005',
          '99999999-9999-9999-9999-999999999999',
          '10000000-0000-0000-0000-000000000009']::uuid[]);
  perform public.test_assert(r.task_id = '10000000-0000-0000-0000-000000000005',
    'only the readable task is projected');
  perform public.test_assert(
    r.missing @> array['99999999-9999-9999-9999-999999999999'::uuid,
                       '10000000-0000-0000-0000-000000000009'::uuid],
    'missing and cross-org ids are explicit unknowns');
end $$;

-- 6. Over-limit request rejected, not silently truncated.
select public.test_denied($q$
  select * from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    (select array_agg(gen_random_uuid()) from generate_series(1, 101))) $q$,
  'more than 100 task ids is rejected, never partial');

-- 7. Authorization: cross-org and anonymous callers are denied.
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
select public.test_denied($q$
  select * from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005']::uuid[]) $q$,
  'cross-org member cannot read the projection');
select public.test_act_as(null);
select public.test_denied($q$
  select * from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005']::uuid[]) $q$,
  'anonymous caller cannot read the projection');
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
reset role;
