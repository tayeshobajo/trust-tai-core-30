# Steward backend — proposed patches (UNAPPLIED)

Status: **UNAPPLIED**. Nothing in this directory has been run against the
hosted Trust Tai Supabase project (`okydosoacqdnursmmenf`). No migration,
deploy, grant, or permission change has been made. Deployment gates remain
off; the live UI keeps showing the precise unavailable reasons.

## What each patch provides

| Patch | Tables | Functions | Purpose |
|---|---|---|---|
| `001_canonical_runs` | `steward_canonical_runs` | `steward_request_canonical_run`, `steward_claim_canonical_run`, `steward_complete_canonical_run`, `steward_fail_canonical_run` | Canonical preparation runner: action allowlist, immutable input snapshot, unique client operation UUID + request digest (same op+same digest replays; same op+changed digest conflicts `P0002`; new op = deliberate rerun), leased claims so a crashed worker never strands a run, bounded attempts (max 3). Never touches `steward_tasks` status or verification. |
| `002_atomic_verification` | `steward_task_receipts`, `steward_task_audit` (append-only) | `steward_verify_task`, `steward_reopen_task` | One-transaction verify/reopen: row lock, expected-revision check, substantive evidence note (≥10 chars), receipt + audit + status in one transaction — any failure rolls back everything. Duplicate operation UUID replays the existing receipt. Reopen appends audit and keeps all prior evidence. |
| `003_coverage_attestation` | `steward_coverage_attestations` | `steward_attest_coverage`, `steward_current_coverage` | Durable coverage attestation keyed to transcript hash + reviewed scope version. Any transcript edit or scope amendment supersedes it; a stale attestation can never keep a meeting at 100. No browser-only flags. |
| `004_proposal_links` | `steward_proposal_links` | `steward_link_proposal` | Explicit human proposal→existing-task link. Unique per proposal; same operation replays, different operation on a linked proposal conflicts `P0030`. Never creates a task or commitment. Linking supersedes coverage for the conversation (scope review invalidated). |

All functions are `security invoker` with `set search_path = public, pg_temp`.

## Apply order

1. `001_canonical_runs.up.sql`
2. `002_atomic_verification.up.sql`
3. `003_coverage_attestation.up.sql`
4. `004_proposal_links.up.sql`

Each is independent (004 depends only on `steward_tasks` existing), but apply
in order so reviewers see runs → verification → coverage → links.

## Rollback

Apply the matching `.down.sql` in reverse order (004 → 001). The harness
verifies rollback leaves no proposed tables behind.

## UNRESOLVED requirement — execute grant (NOT applied)

The patches contain **only revokes** (`public`, `anon`). For the app to call
these functions, a reviewer must additionally run, per function:

```sql
grant execute on function public.<fn>(...) to authenticated;
```

This is deliberately **not** in the patches: widening grants is a reviewed
permission decision and stays blocked until separately authorized. Until
then the UI remains in its exact disabled state.

RLS note: the fixture harness has no RLS; on the real project the new tables
need RLS enabled with org-scoped policies matching the existing
`steward_tasks` conventions before any grant is considered. That policy text
is part of the same unresolved review.

## Assumptions checklist

- `steward_tasks` exists with columns: `id, organization_id, title,
  task_visibility, owner_user_id, created_by, status, completion_evidence,
  completed_at, completed_by, archived_at, revision, updated_at`
  (mirrored in `harness/fixture.sql`). If the hosted table differs, the
  patches must be adjusted before apply — verify during review, not here.
- Authorization model: requester must be the task creator or owner
  (001/002/004 enforce this in-function). Org membership enforcement is
  expected from RLS on the real project; the harness cannot test it.
- Action allowlist for runs: `prepare_brief`, `prepare_handoff`,
  `draft_roadmap`, `review_output` (CHECK constraint; extending it is a
  patch change, not runtime config).
- Transcript hash: any stable ≥16-char digest of the ordered transcript
  text/speaker/offsets the sync layer already compares.
- No provider call lives in SQL; the TS runner (`src/lib/steward-canonical-
  run.server.ts`) calls the claim/complete functions and injects the
  provider. Tests use a fake provider only.

## Isolated verification

`bash docs/proposed/steward-backend/harness/run.sh` spins up a disposable
PostgreSQL 17 on port 55444, applies fixture + all up patches, runs:

- `001_runs.sql` — queued start, replay/conflict semantics, actor authority,
  claim exclusivity, complete/fail authority, attempt exhaustion, expired-
  lease recovery.
- `002_verification.sql` — verify happy path, duplicate-operation replay,
  revision conflict, short-evidence rejection, reopen preserves history,
  unauthorized actor rejection, rollback on audit failure.
- `003_coverage.sql` — no attestation ⇒ not covered; attest ⇒ covered;
  transcript edit invalidates; scope-version change invalidates; re-attest
  restores.
- `004_links.sql` — link happy path, idempotent replay, conflicting second
  link, cross-org task rejection, no task/commitment creation, coverage
  invalidation on link.
- `005_concurrency.sh` — two racing claims: exactly one winner, attempts=1.
- Rollback: all down patches leave zero proposed tables.

Latest run: **ALL HARNESS CHECKS PASSED** (exit 0).


## Hardening revision (source review follow-up)

- All functions derive the actor from `auth.uid()`; no caller-supplied actor
  parameter exists anywhere. Every function re-validates active org
  membership and write role on each call, including replays.
- Mutation functions are SECURITY DEFINER with pinned search_path so they
  can write while clients cannot: table grants for `authenticated` are
  SELECT-only (see `grants.review.sql`) and RLS has select-only policies.
  Receipts, audit, attestations, links and scope history are immutable —
  update/delete triggers block all mutation except the function-internal
  supersede path guarded by a transaction-local flag.
- Authority checks are NULL-safe (`is distinct from`): a task with no owner
  or creator is admin-only, never accidentally public.
- Canonical runs: the request snapshot persists RESOLVED content +
  sha256 digest per input; execution reads only the snapshot. The request
  digest binds org + task + requester + action + full input identity, so a
  reused operation UUID with any changed element conflicts (P0002).
  Claims issue a fencing token (claim_token/claim_version); complete/fail
  require the current token and an unexpired lease, so a stale worker
  cannot complete a reclaimed run. Exhausted-attempt failure is scoped to
  the requester.
- Coverage attestations read the stored transcript hash and durable scope
  version server-side; callers supply neither. Transcript edits, proposal
  links and scope amendments all invalidate coverage in the same
  transaction.
- Proposal links validate the proposal exists in the same conversation and
  org, never create tasks, and durably bump the scope version.
- Scope membership (005) is durable: archived required tasks stay in the
  denominator, deletes are disabled, amendments require a >=10-char reason
  and are audited; `steward_scope_counts` is a single consistent snapshot
  (exists-based verified count, no join fan-out).
- Rollback: `00x.down.sql` preserves all history AND its protection —
  operational functions are dropped, but RLS stays enabled, select policies
  stay in place, and immutability triggers keep firing, so retained
  cross-org history is never exposed by a rollback (harness test 007
  verifies post-rollback reads for cross-org/inactive/viewer roles).
  `teardown.destructive.sql` is a single atomic block that refuses while
  any history row exists.

## Integration revision (second source review follow-up)

- Schema now mirrors the REAL repository contracts: coverage hashes the
  actual `public.conversations.transcript` jsonb server-side, and proposals
  live in an additive `steward_proposal_ledger` keyed by conversation +
  source key (matching commitment `source_key` extraction) — no invented
  base tables.
- `steward_current_coverage` and `steward_scope_counts` are SECURITY
  DEFINER (they enforce membership themselves); `steward_transcript_hash`
  stays definer-only and is never granted to authenticated.
- RLS policy helper `private.steward_is_active_member` keeps EXECUTE for
  authenticated (read-only membership check; policies evaluate it as the
  querying role). All other helpers stay revoked.
- Claim/complete/fail are granted to `service_role` ONLY — a signed-in
  client cannot forge an artifact. The staged worker path
  (`runCanonicalRunWorkerFn`) uses the admin client for exactly this
  reason, stays capability-gated off, and its default provider throws
  (no real model calls until separately reviewed).
- Concrete Supabase adapters exist for runs, verification, coverage,
  proposal links and scope (`src/lib/steward-*.supabase.ts`).
  `src/lib/steward-supabase-adapters.test.ts` parses the SQL files and
  asserts every adapter call uses the exact function name and parameter
  names the SQL declares.
- Harness additions: `000_acl_pregrant.sql` / `000b_acl_postgrant.sql`
  assert pg_proc ACLs before/after the local-only grant script;
  `008_journey.sql` runs the full fixture journey (request → worker claim →
  artifact → human verify → reopen → legacy-status-flip earns nothing →
  coverage attest → scope counts) through the real SQL surface.
- Harness (`harness/run.sh`): mktemp-owned PGDATA, `listen_addresses=''`,
  private socket, unprivileged user, no externally supplied path deletion.
  Tests run as `authenticated` with JWT claims for owner/member/viewer/
  inactive/cross-org users and cover direct-write denial, spoofing
  (impossible — no actor param), fencing races, concurrent duplicate
  requests, and rollback.
