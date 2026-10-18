-- Coverage attestation keyed to transcript hash + scope version.
-- 1. No attestation: coverage is not confirmed.
do $$
begin
  assert not steward_current_coverage(:org_a, :conv_1, 'hash-v1', 1);
end $$;

-- 2. Attest, then confirm with the same hash+version.
do $$
begin
  perform steward_attest_coverage(:org_a, :conv_1, 'hash-v1', 1, :user_owner);
  assert steward_current_coverage(:org_a, :conv_1, 'hash-v1', 1);
end $$;

-- 3. A transcript edit (new hash) invalidates coverage.
do $$
begin
  assert not steward_current_coverage(:org_a, :conv_1, 'hash-v2-EDITED', 1),
    'edited transcript must invalidate coverage';
end $$;

-- 4. A scope amendment (new version) invalidates coverage.
do $$
begin
  assert not steward_current_coverage(:org_a, :conv_1, 'hash-v1', 2),
    'scope change must invalidate coverage';
end $$;

-- 5. Re-attestation supersedes the old row; only the latest counts.
do $$
declare n integer;
begin
  perform steward_attest_coverage(:org_a, :conv_1, 'hash-v2-EDITED', 2, :user_owner);
  select count(*) into n from steward_coverage_attestations
   where conversation_id = :conv_1::uuid and superseded_at is null;
  assert n = 1, 'exactly one current attestation per conversation';
  assert steward_current_coverage(:org_a, :conv_1, 'hash-v2-EDITED', 2);
  assert not steward_current_coverage(:org_a, :conv_1, 'hash-v1', 1);
end $$;
