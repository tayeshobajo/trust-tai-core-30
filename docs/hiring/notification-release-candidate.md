# Hiring notification release candidate — NOT ACTIVATABLE

## Scope and status

Imported the attached preparation module/tests first. Its three new files applied;
the test-config hunk referenced a file absent from this checkout, so a focused
equivalent config was created. The `git apply --check` command was refused by the
environment; `patch --dry-run` checked the three files and reported only the
missing config. Prepared design/assets remain unchanged.

Receipt preparation targets saved applicant email. Owner alert requires one
current verified active entitled assigned owner; absent/ambiguous owner blocks
internal alert, not receipt. Tai copy requires verified active entitled Tai at
`tai@trust-tai.com`; Tai as owner deduplicates the copy. Unknown identity is never
broadcast. No recipient may come from a public payload.

The sequential worker candidate caps five claims and five observed-status reads
per invocation. It uses existing Resend gateway credentials, HTML plus text,
stable application/purpose/version/mode idempotency, TLS and redirect:error.
Provider acceptance is sent, not delivered. Interrupted/uncertain outcomes do
not automatically resend. Definitive failures/bounces are preserved. All QA
purposes target `delivered@resend.dev`, never live owners or applicants.

The authenticated-secret scheduler endpoint is
`POST /api/public/hiring/notifications`, using `X-Hiring-Notification-Key` and
the separate server-only `HIRING_NOTIFICATION_CRON_SECRET`. No secret was
generated/configured; no cron was installed. Even a valid key currently returns
`review_required`, zero claims, zero reconciliations. The candidate adapter is
not wired to the scheduler. Intake, manual-message delivery, UI, public website
and existing service contracts are unchanged.

## Blocking canonical schema prerequisite

The supplied introspection confirms runtime id/intake state and historical
synthetic counts, but not exact table columns, nullability, CHECKs, foreign keys,
grants, RLS or bodies of `hiring_submit`, `hiring_allowed`, `hiring_queue_qa`,
`hiring_claim_delivery` and `hiring_settle_delivery`. Those definitions are not
in this checkout or uploaded patches. No hosted introspection was attempted.

Consequently this is a **partial, source-held candidate**, not a complete
activatable notification system. Missing work: canonical transactional queue
hook, current authority reads inside queue/claim, claim lease expiry handling,
recoverable queue-attention audit, exact settlement/observation adapters, and
protected explicit synthetic QA entry. No pretend implementation or new ATS
was substituted. Durable submit still succeeds independently with its existing
`delivery: disabled` response. No UI claims automatic receipts are enabled.

`notifications.pending.sql` is the exact additive **review sketch**, not a
production migration or complete activation SQL. It extends existing tables
only, defaults disabled, adds purpose uniqueness and snapshot immutability; it
does not queue any row or replace existing routines. It must be completed after
exact-schema review, particularly write grants and existing message NOT NULLs.
The isolated SQL fixture tests only this additive sketch, never hosted schema.

## Required completion contracts

1. On genuinely new durable application insertion only, lock/check runtime with
   notifications enabled and saved timestamp strictly after immutable activation
   cutoff. Never attach intents on submission replay or scan historical rows.
2. Capture immutable application/role/template intent; verify current membership,
   auth confirmation, organization and Hiring entitlement by ID inside queue AND
   claim. Receipt independent from owner/Tai failure. Dedupe Tai owner/copy.
3. Queue in an exception-contained subtransaction; preserve durable application,
   record recoverable attention using an existing authorized audit contract. A
   scheduler retries only recorded post-cutoff queue attention, not old intake.
4. Private atomic claim uses row lock/SKIP LOCKED, lease UUID and expiry. Expired
   attempted claims become unknown, never queued. Snapshot revision/payload bound
   settlement requires matching lease; revoke public/member system-write access.
5. Reconciliation uses provider ID and observations only; unknown without provider
   ID needs human review, never resubmission. Preserve definitive failed/bounced.
6. Explicit authenticated Hiring QA entry queues synthetic records only; accepts
   no recipient/mode/public payload override. All generated intents go to an
   approved test destination. Manual employment-message sends remain QA-only.

## Review/release steps (all pending; nothing executed)

1. Supply exact canonical schema/routine/grant definitions, finish and review SQL;
   run complete isolated policy/transaction/replay/lease/nonbackfill tests.
2. Wire reviewed routines to the source-held scheduler; independent app type/build
   and deployed evidence required. No Studio/dependency repairs in this change.
3. Review disabled migration separately; user applies production SQL only after
   approval, then verifies notification runtime remains false and queue empty.
4. User authorizes secure separate scheduler secret provisioning and cron setup.
   Generate without display; bind to the published CMD endpoint only after release.
   Cadence/batch must be reviewed; no inline secret SQL or logs.
5. User approves explicit synthetic QA, then reviews provider receipts; no emails
   were sent here. Only after this review activate runtime with a new cutoff,
   independently of intake_enabled. Never backfill historical notifications.

## Evidence

- `bunx vitest run --config vitest.hiring-design.config.ts`: exit **0**, **127 tests
  passed in nine files** (existing 82, prepared templates 22 including seven
  Tai-copy tests, worker/scheduler 23). All provider and storage calls mocked.
- `bunx eslint src/lib/hiring-email-*.ts src/routes/api/public/hiring.notifications.ts vitest.hiring-design.config.ts`:
  exit **0**. `git diff --check`: exit **0**.
- `bash qa/hiring-notifications/run.sh`: final exit **0** using a private Unix
  socket PostgreSQL instance, no network listener. Verified disabled default,
  empty cutoff, unchanged historical rows/no backfill, unique purpose key,
  immutable snapshot, rejection of historical conversion, ordinary settlement.
  Earlier harness attempts exited **1**: missing postgres account, then runuser
  unavailable; setpriv with existing UID 1000 succeeded. No hosted database used.
- Latest automatic diagnostic at **2026-11-13T01:43:59Z** reports the eight
  pre-existing Studio coordinator type errors only; no Hiring errors remain.
  Full app build/typecheck is **not green**, pending independent execution. No
  manual build/typecheck, dependency installation or Studio repair was run.
- Sandbox presence only: RESEND_API_KEY **true**, LOVABLE_API_KEY **true**,
  TRUST_TAI_SUPABASE_SERVICE_KEY **true**, SUPABASE_SERVICE_ROLE_KEY **false**,
  HIRING_NOTIFICATION_CRON_SECRET **false**. No values inspected or disclosed;
  hosted configuration availability remains unverified.
- Logs: `/tmp/hiring-email-checks/tests-final.log`, `lint-final.log`,
  `sql-final.log`. No emails, live mutations, flags, cron, SQL activation,
  credentials, publication or backfill. Both real roles/revisions untouched.