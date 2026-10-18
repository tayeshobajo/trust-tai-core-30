-- Verification projection RPC: one-statement snapshot, latest receipt per
-- task by the canonical monotonic criterion (task_revision_after DESC,
-- created_at DESC, id DESC), business-only visibility under SECURITY
-- DEFINER, no silent truncation, explicit unknowns.
--
-- Fresh fixture tasks (inserted as the superuser, not by the API):
--   ...0d  tie: older reopen with HIGHER uuid, newer verify with LOWER uuid
--   ...0e  tie: older verify with HIGHER uuid, newer reopen with LOWER uuid
--   ...0f  same-org PERSONAL task owned by the member (bbbb)
--   ...10  bulk-receipt task (1200 verifies then a final reopen)
insert into public.steward_tasks
  (id, organization_id, title, notes, correlation_id, task_visibility, owner_user_id, created_by, status, revision, archived_at)
values
  ('10000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   'Tie probe: verify current', 'Projection tie probe.', null, 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'complete', 3, null),
  ('10000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
   'Tie probe: reopen latest', 'Projection tie probe.', null, 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'complete', 3, null),
  ('10000000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111',
   'Member personal task', 'Private member notes must not leak.', null, 'personal',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'complete', 4, null),
  ('10000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'Bulk receipt probe', 'Projection bulk probe.', null, 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'complete', 1201, null);

-- 1. Bulk receipts far beyond the PostgREST 1000-row cap on ONE task:
--    1200 verify receipts (monotonic revisions) then a FINAL reopen. The
--    projection must see the reopen (false), proving no truncation.
do $$
declare
  i int;
begin
  for i in 1..1200 loop
    insert into public.steward_task_receipts
      (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id, created_at)
    values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000010',
      gen_random_uuid(), 'verify', 'bulk receipt', 'digest-' || i, i,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - (interval '1 second' * (1300 - i)));
  end loop;
  insert into public.steward_task_receipts
    (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id, created_at)
  values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000010',
    gen_random_uuid(), 'reopen', 'final reopen after bulk verifies', 'digest-final', 1201,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());
end $$;
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare r record;
begin
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000010']::uuid[]);
  perform public.test_assert(r.latest_kind = 'reopen' and r.verified = false,
    'latest reopen wins over 1200 earlier verifies — no truncation');
end $$;

-- 2. Same-timestamp ties decided by the canonical monotonic revision,
--    NOT by random uuid order. Identical created_at on every receipt.
reset role;
do $$
declare
  t timestamptz := now();
begin
  insert into public.steward_task_receipts
    (id, organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id, created_at)
  values
    -- 0d: OLD reopen (rev 2) has the HIGHER uuid; NEW verify (rev 3 =
    --     current revision) has the LOWER uuid. Must be verified.
    ('ffffffff-ffff-ffff-ffff-ffffffff0001', '11111111-1111-1111-1111-111111111111',
     '10000000-0000-0000-0000-00000000000d', gen_random_uuid(), 'reopen', 'old tie reopen',
     'tie-d1', 2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', t),
    ('00000000-0000-0000-0000-00000000d002', '11111111-1111-1111-1111-111111111111',
     '10000000-0000-0000-0000-00000000000d', gen_random_uuid(), 'verify', 'new tie verify',
     'tie-d2', 3, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', t),
    -- 0e: OLD verify (rev 2) has the HIGHER uuid; NEW reopen (rev 3) has
    --     the LOWER uuid. Must NOT be verified.
    ('ffffffff-ffff-ffff-ffff-ffffffff0002', '11111111-1111-1111-1111-111111111111',
     '10000000-0000-0000-0000-00000000000e', gen_random_uuid(), 'verify', 'old tie verify',
     'tie-e1', 2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', t),
    ('00000000-0000-0000-0000-00000000e002', '11111111-1111-1111-1111-111111111111',
     '10000000-0000-0000-0000-00000000000e', gen_random_uuid(), 'reopen', 'new tie reopen',
     'tie-e2', 3, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', t);
  -- Isolated conversation so the SAME tie tasks can be scored by
  -- steward_scope_counts and compared against the projection.
  insert into public.conversations (id, organization_id, title)
  values ('dddddddd-dddd-dddd-dddd-ddddddddd7e2', '11111111-1111-1111-1111-111111111111',
          'Projection tie conversation');
  insert into public.steward_scope_items
    (organization_id, conversation_id, task_id, classification, operation_id, request_digest, added_by)
  values
    ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-ddddddddd7e2',
     '10000000-0000-0000-0000-00000000000d', 'manual_required', gen_random_uuid(), 'tie-scope-d',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-ddddddddd7e2',
     '10000000-0000-0000-0000-00000000000e', 'manual_required', gen_random_uuid(), 'tie-scope-e',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
end $$;
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare
  d record;
  e record;
  c record;
begin
  select * into d from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-00000000000d']::uuid[]);
  perform public.test_assert(d.latest_kind = 'verify' and d.latest_revision_after = 3
      and d.verified = true,
    'tie: newer verify at current revision wins over older reopen with higher uuid -> TRUE');
  select * into e from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-00000000000e']::uuid[]);
  perform public.test_assert(e.latest_kind = 'reopen' and e.latest_revision_after = 3
      and e.verified = false,
    'tie: newer reopen wins over older verify with higher uuid -> FALSE');
  -- Same criterion in the score: exactly the projection's verified set.
  select * into c from public.steward_scope_counts(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-ddddddddd7e2');
  perform public.test_assert(c.denominator = 2 and c.verified = 1,
    'scope score counts exactly the projection-verified tie task (2 required, 1 verified)');
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

-- 4. Legacy complete with NO receipt: never verified.
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

-- 5. Missing, cross-org and PERSONAL ids come back as unknowns, never
--    false, and personal status/revision never leaks (SECURITY DEFINER
--    bypasses RLS, so the business filter is what protects them).
do $$
declare
  r record;
  n int;
begin
  select * into r from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005',
          '99999999-9999-9999-9999-999999999999',
          '10000000-0000-0000-0000-000000000009',
          '10000000-0000-0000-0000-000000000004',
          '10000000-0000-0000-0000-00000000000f']::uuid[]);
  perform public.test_assert(r.task_id = '10000000-0000-0000-0000-000000000005',
    'only the readable business task is projected');
  perform public.test_assert(
    r.missing @> array['99999999-9999-9999-9999-999999999999'::uuid,
                       '10000000-0000-0000-0000-000000000009'::uuid,
                       '10000000-0000-0000-0000-000000000004'::uuid,
                       '10000000-0000-0000-0000-00000000000f'::uuid],
    'missing, cross-org and personal ids are explicit unknowns');
  -- Owner requesting ONLY another member's personal task: no row at all.
  select count(*) into n from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-00000000000f']::uuid[]);
  perform public.test_assert(n = 0, 'other member''s personal task: no row, no status/revision');
  -- Owner requesting ONLY their OWN personal task: also no row.
  select count(*) into n from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000004']::uuid[]);
  perform public.test_assert(n = 0, 'own personal task: no row (canonical Steward is business-only)');
end $$;
-- The member requesting their OWN personal task: no row either.
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
do $$
declare n int;
begin
  select count(*) into n from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-00000000000f',
          '10000000-0000-0000-0000-000000000004']::uuid[]);
  perform public.test_assert(n = 0, 'member: own and other personal tasks both unknown');
end $$;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 6. Over-limit request rejected, not silently truncated.
select public.test_denied($q$
  select * from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    (select array_agg(gen_random_uuid()) from generate_series(1, 101))) $q$,
  'more than 100 task ids is rejected, never partial');

-- 7. Authorization: cross-org, inactive and anonymous callers are denied.
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
select public.test_denied($q$
  select * from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005']::uuid[]) $q$,
  'cross-org member cannot read the projection');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select * from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005']::uuid[]) $q$,
  'inactive member cannot read the projection');
select public.test_act_as(null);
select public.test_denied($q$
  select * from public.steward_meeting_verification_projection(
    '11111111-1111-1111-1111-111111111111',
    array['10000000-0000-0000-0000-000000000005']::uuid[]) $q$,
  'anonymous caller cannot read the projection');
-- (anon has no EXECUTE at all: covered by 000/000b ACL snapshots.)
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
reset role;
