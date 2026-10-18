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
