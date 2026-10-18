# Steward backend — proposed patches (UNAPPLIED)

Status: **UNAPPLIED**. Nothing in this directory has been run against the
hosted Trust Tai Supabase project (`okydosoacqdnursmmenf`). No migration,
deploy, grant, or permission change has been made. Deployment gates remain
off; the live UI keeps showing the precise unavailable reasons (the staged
server entrypoints are capability-gated OFF — they report "staged, not
activated" and touch nothing while the flags are unset).


## 007 — verification projection (read-only)

`steward_meeting_verification_projection(org, task_ids)` returns, in ONE
statement snapshot, each requested task's status, current revision,
latest receipt and the receipt-backed verified flag.

- SECURITY DEFINER bypasses table RLS, so visibility is explicit: active
  org membership gate + `organization_id = p_org` + `task_visibility =
  'business'`. Personal tasks (the caller's own or another member's) never
  return a row; status/revision cannot leak.
- Latest receipt = `task_revision_after DESC, created_at DESC, id DESC`,
  the SAME criterion `steward_scope_counts` (005) now uses, so a timestamp
  tie can never be decided by random UUID order.
- Requested ids with no returned row (including the zero-visible-rows
  case) are unknown in the adapter, never false. More than 100 ids is
  rejected, never truncated.
- The selected-task read uses this projection for one id (verified,
  status and the revision a gesture captures); receipt history is a
  separate display-only read, latest 100 with disclosed truncation.
- Up patch is revoke-only; the authenticated execute grant lives only in
  grants.review.sql; the down patch drops the read-only function and
  preserves all history.

## Scope amendment authority (005, hardened)

`steward_scope_amend_remove` and `steward_scope_amend_reinstate` require
the SAME canonical task authority as add/link/verify: business task +
creator/current owner/admin + active writer, reauthorized BEFORE any
operation replay (an ownership transfer between the first call and its
retry denies the retry). The operation digest binds org + conversation +
item + reason + actor. Regression probe: an unrelated active member
cannot remove or reinstate another member's scoped task.

## Security model

- All functions are `security definer` with `set search_path = public, pg_temp`.
  Identity is derived from `auth.uid()` — no caller-supplied actor is ever
  trusted. Every function re-validates active org membership and write role
  (`private.steward_can_write`) and, where a task is involved, canonical
  task authority (`private.steward_user_has_task_authority`: business
  visibility AND creator/current owner/org admin; personal tasks fail
  closed).
- New tables have RLS enabled with member-scoped SELECT policies only; all
  mutation flows through the functions. History tables
  (`steward_task_receipts`, `steward_task_audit`, `steward_scope_audit`,
  `steward_proposal_decisions`) are append-only via immutability triggers.
- The patches contain **only revokes** (`public`, `anon`, `authenticated`).
  Executable grants live in `grants.review.sql`, which is review-only and
  must be applied explicitly by a reviewer after the patches land.
- Worker-only transitions (claim/complete/fail/uncertain) are granted to
  `service_role` only; a signed-in client can never mint an artifact.

## What each patch provides

| Patch | Tables | Functions | Purpose |
|---|---|---|---|
| `001_canonical_runs` | `steward_canonical_runs` | `steward_request_canonical_run`, `steward_claim_canonical_run`, `steward_complete_canonical_run`, `steward_fail_canonical_run`, `steward_uncertain_canonical_run` | Canonical preparation runner: action allowlist, immutable input snapshot resolved server-side, unique client operation UUID + request digest (same op+same digest replays the explicit `{run, replayed}` envelope; changed digest conflicts `P0002`; new op = deliberate rerun), leased claims, bounded attempts. Timed-out/uncertain provider outcomes are terminally failed (`uncertain:` reason) and never requeued — a deliberate rerun needs a new operation UUID. Never touches `steward_tasks` status or verification. |
| `002_atomic_verification` | `steward_task_receipts`, `steward_task_audit` (append-only) | `steward_verify_task`, `steward_reopen_task` | One-transaction verify/reopen: row lock, expected-revision check, substantive evidence note (≥10 chars), receipt + audit + status atomically. Duplicate operation UUID replays the existing receipt; changed payload conflicts. Reopen appends audit and keeps all prior evidence. |
| `003_coverage_attestation` | `steward_coverage_attestations` | `steward_attest_coverage`, `steward_current_coverage` | Durable coverage attestation bound to the exact transcript hash + scope version the human REVIEWED: the caller supplies `p_operation`, `p_expected_hash`, `p_expected_scope_version`; the function derives the CURRENT stored values itself and rejects drift (`source_changed_since_review`), so a source change during review is never silently attested. Same operation UUID + same binding replays the recorded attestation; changed binding conflicts. Any transcript edit or scope amendment supersedes it; a stale attestation can never keep a meeting at 100. |
| `004_proposal_links` | `steward_proposal_ledger`, `steward_proposal_links`, `steward_proposal_decisions` (append-only) | `steward_register_proposals`, `steward_link_proposal`, `steward_dismiss_proposal` | Extraction ledger + explicit human link/dismiss. Registration is idempotent re-extraction bound to the exact transcript; link/dismiss are human decisions persisted with reason, actor, operation UUID and digest — same operation replays, changed payload conflicts. Linked/dismissed transitions are row-locked. Never creates tasks or commitments. **A link atomically adds the confirmed task to the required-scope denominator (005 tables) in the same transaction**, so a proposal can never be marked linked while its obligation stays out of the score. |
| `005_scope_membership` | `steward_scope_items`, `steward_scope_audit` (append-only) | `steward_scope_add_item`, `steward_scope_sync_required`, `steward_scope_amend_remove`, `steward_scope_amend_reinstate`, `steward_scope_counts` | Durable required-work denominator. Archiving never removes scope; removal is an audited amendment that bumps the scope version (invalidating coverage); reinstatement of a removed item is a separate explicit, reasoned, audited amendment (`amend_reinstate`) — a removed item blocks proposal linking (004 fail-closed) until a human deliberately reinstates it, never silently revived. Conversations must belong to the org; correlation keys must match the exact `cmd-meeting-required:v1:<meetingUUID>:<opUUID>` format; dedup is per organization+conversation; amendment operations replay via the audit trail. Verified credit is revision-bound. |
| `006_meeting_score_snapshot` | — (read-only) | `steward_meeting_score_snapshot` | Consistent one-statement score snapshot: denominator, verified, pending proposals, coverage currency, attestation time, scope version and the current transcript hash (the value a coverage review binds to) read together, so the UI never assembles 100 from mixed or stale component reads. The `complete` verdict is computed in the same statement. Like every patch it contains revokes only; its `GRANT EXECUTE` lives in `grants.review.sql`. |

## Apply order

1. `001_canonical_runs.up.sql`
2. `002_atomic_verification.up.sql`
3. `003_coverage_attestation.up.sql`
4. `004_proposal_links.up.sql` — the link function resolves the 005 scope tables at first call (a `record` variable, not a create-time type dependency), so numeric order is safe.
5. `005_scope_membership.up.sql`
6. `006_meeting_score_snapshot.up.sql`
7. `grants.review.sql` (explicit reviewer step; never automatic)

## Rollback (data-preserving)

Apply the matching `.down.sql` in reverse order (006 → 001). Rollback drops
the mutation FUNCTIONS ONLY. Tables, RLS policies, select policies and the
immutability/append-only triggers are KEPT, so retained history stays
org-scoped and immutable after rollback. `teardown.destructive.sql` is the
only script that drops data and it refuses to run while history rows exist.

## Staged application code (capability-gated OFF)

| Module | Status |
|---|---|
| `src/lib/steward-canonical-run.server.ts` / `.supabase.ts` / `.provider.server.ts` / `.functions.ts` | Domain service, Supabase adapter, bounded provider, and protected entrypoints (`requestCanonicalRunFn`, `runCanonicalRunWorkerFn`, `getCanonicalRunCapability`). Gated by `STEWARD_CANONICAL_RUNS_ENABLED` (default off); provider readiness is checked before queueing. The worker endpoint authorizes the caller through their own RLS view (`authorizeWorkerEndpoint`) before any privileged transition. |
| `src/lib/steward-verification.server.ts` / `.supabase.ts` | Atomic verify/reopen service + adapter, consumed by `steward-verification.functions.ts` (capability-gated `STEWARD_VERIFICATION_ENABLED`, OFF) and the workroom `VerificationPanel`. While OFF the panel renders the server's unavailable reason and no control is reachable. |
| `src/lib/steward-coverage.server.ts` / `.supabase.ts` | Coverage attestation service + adapter, consumed by `steward-coverage.functions.ts` (capability-gated `STEWARD_COVERAGE_ENABLED`, OFF) and the workroom scope-review panel. |
| `src/lib/steward-proposal-ledger.server.ts` / `.supabase.ts` / `.functions.ts` | Extraction ledger service, adapter, and the capability-gated sync entrypoint (`syncProposalLedgerFn`, flag `STEWARD_PROPOSAL_LEDGER_ENABLED`, default off) that runs the REAL `extractProposals` over the stored transcript and registers the output. |
| `src/lib/steward-proposal-link.server.ts` / `.supabase.ts` | Human link service + adapter, consumed by `steward-proposal-link.functions.ts` (capability-gated `STEWARD_PROPOSAL_LINKS_ENABLED`, OFF) and the workroom scope-review panel. |
| `src/lib/steward-trust-tai-auth.server.ts` | Dedicated auth middleware for all Steward canonical entrypoints: same Bearer→getClaims validation shape as the generated middleware, but pinned to the Trust Tai backend via `trust-tai-backend.server.ts` helpers — a mis-pointed generic env can never move these entrypoints to another project. The generated middleware file is untouched. |
| `src/lib/steward-run-state.functions.ts` | Read-state entrypoint for canonical runs/artifacts (RLS as the caller), consumed by the workroom AI panel. Gated by the same `STEWARD_CANONICAL_RUNS_ENABLED` flag. |
| `src/components/tt/steward/workroom-backend-panels.tsx` | Presentational panels (preparation runs, verification, scope review) wired into `workroom.tsx` via `useStewardBackend`. With every flag OFF the live workroom shows the staged/not-activated reasons; enabled behavior is exercised only in isolated fixtures. |

## Verification

`harness/run.sh` spins up a disposable private PostgreSQL (no network
listener, fresh mktemp data dir, non-root), applies the fixture + patches +
local-only grants, and runs:

- `tests/001_runs.sql` … `005_scope.sql` — per-patch behavior, ACL,
  idempotency, authority and adversarial cases (foreign conversation,
  malformed correlation keys, cross-meeting dedup, amendment replay).
- `tests/006_concurrency.sh` — concurrent duplicate requests and claim
  fencing (stderr visible; no suppression).
- `tests/007_adapter_journey.sh` — real service+SQL journey
  (`src/lib/steward-journey.sql.test.ts`): psql-backed repositories
  implementing the same interfaces as the Supabase adapters drive
  request → replay → claim → artifact → verify → replay → reopen, plus
  worker-endpoint denials and the proposal ledger, so SQL↔TS mapping
  defects cannot hide behind in-memory fakes.
- `tests/008_journey.sql` — SQL-only end-to-end journey.
- Rollback: all `.down.sql` patches, then `tests/007_rollback.sql` verifies
  retained history stays protected.

## Remaining blockers (honest)

- The patches are NOT applied to the hosted project; applying them is a
  reviewed, gated step this work deliberately does not perform.
- `grants.review.sql` needs explicit reviewer application.
- Provider wiring for canonical runs requires deployment configuration that
  is not set; until then the UI reports the precise unavailable reason and
  no run can be queued or executed.
- Verified 100/100 remains unreachable until the verification, coverage and
  scope contracts are applied AND exercised; the UI says so.
