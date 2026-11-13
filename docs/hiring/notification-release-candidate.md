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
not automatically resend. Recent delivered rows remain observable for subsequent
bounced/complained/failed events. Sent, unknown and repeated delivered events do
not downgrade or duplicate delivered evidence; failures remain terminal. All QA
purposes target `delivered@resend.dev`, never live owners or applicants.

The authenticated-secret scheduler endpoint is
`POST /api/public/hiring/notifications`, using `X-Hiring-Notification-Key` and
the separate server-only `HIRING_NOTIFICATION_CRON_SECRET`. No secret was
generated/configured; no cron was installed. Even a valid key currently returns
`review_required`, zero claims, zero reconciliations. The candidate adapter is
not wired to the scheduler. Intake, manual-message delivery, UI, public website
and existing service contracts are unchanged.

## Blocking canonical schema prerequisite

Canonical metadata now exists locally with the independent reviewer, but its
upload to this Lovable project was explicitly BLOCKED by automatic approval
review; user confirmation of that transfer is pending. No alternate route,
hosted introspection or inferred SQL is permitted. The exact columns, constraints,
grants, RLS and routine definitions remain unavailable here for implementation.

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
   ID needs human review, never resubmission. Preserve definitive failures.
6. Explicit authenticated Hiring QA entry queues synthetic records only; accepts
   no recipient/mode/public payload override. All generated intents go to an
   approved test destination. Manual employment-message sends remain QA-only.

### Required bounded reconciliation contracts (not implemented SQL)

- `hiring_notification_reconcile_candidates` must enforce a hard DB limit of five,
  purpose/org/runtime/activation-cutoff scope and a durable provider ID. Include
  eligible sent/unknown rows and recent delivered rows, exclude failed/bounced/
  complained/suppressed. Never select historical intake or create new intents.
- Define an exact finite delivered-observation duration and minimum poll interval
  after metadata review; no duration is invented here. Anchor the window to the
  first durable delivery observation, not the last poll, so polling cannot extend
  it indefinitely. Track last check/next eligibility separately and rotate eligible
  rows deterministically to avoid starving sent/unknown rows. Reserve eligibility
  atomically for concurrent workers; unavailable provider reads must still respect
  the polling interval. Observations outside the window are not guaranteed.
- `hiring_observe_notification` must lock and re-read current canonical state and
  provider binding, reject stale/mismatched observations, preserve provider ID,
  make repeated evidence idempotent, and append authorized audit evidence atomically.
  Delivered may become failed for bounce/complaint/failure/suppression, never sent
  or unknown. A concurrent terminal failure must not be overwritten by delivered.
- Existing candidate port names/shapes are proposals only. Exact schema review must
  settle reservation/version ownership and timestamp fields before adapter wiring.
  Worker tests prove bounded mocked reads/state mapping, not durable SQL enforcement.

## Review/release steps (pending; existing authorization preserved)

Tai's existing approval authorizes the scoped bounded activation/controlled tests
after checks. No new blanket approval is required. This turn remains source-only:
Tai handles final migration, deployment and sending after independent review.
The current gate is denied metadata transfer and unimplemented canonical contracts,
not absent email authorization. Intake enablement is not email enablement.

1. Resolve the explicitly blocked metadata transfer through its existing approval,
   then review exact canonical definitions, finish and review SQL;
   run complete isolated policy/transaction/replay/lease/nonbackfill tests.
2. Wire reviewed routines to the source-held scheduler; independent app type/build
   and deployed evidence required. No Studio/dependency repairs in this change.
3. Under existing scoped authorization, user applies reviewed disabled migration,
   then verifies notification runtime remains false and queue empty.
4. User handles secure separate scheduler secret provisioning and cron setup.
   Generate without display; bind to the published CMD endpoint only after release.
   Cadence/batch must be reviewed; no inline secret SQL or logs.
5. User runs already-authorized controlled synthetic QA, then reviews provider receipts; no emails
   were sent here. Only after this review activate runtime with a new cutoff,
   independently of intake_enabled. Never backfill historical notifications.

## Evidence

### Independent source correction verification

- `bunx vitest run --config vitest.hiring-design.config.ts`: exit **0**, **136
  tests in nine files**, including delivered → bounced/complained/failed, no
  downgrade on sent/unknown, repeated delivered no-op, terminal failure retention,
  and five-read bound. An initial test run exited **1** because a mocked Response
  body was reused across reads; fresh mocked responses corrected the test fixture.
- `bunx eslint src/lib/hiring-email-worker.server.ts src/lib/hiring-email-worker.test.ts`:
  final exit **0** after scoped formatter corrections; `git diff --check`: **0**.
- `bash -n qa/hiring-notifications/run.sh`: **0**;
  `bash qa/hiring-notifications/run.sh`: **0**;
  `setpriv --reuid=1000 --regid=1000 --clear-groups bash qa/hiring-notifications/run.sh`:
  **0**. Root and unprivileged isolated additive checks passed. The non-root
  branch now uses `PG_RUN=(env)` under nounset. Sandbox Bash is 5.3.9; native
  macOS Bash 3 execution was not available, so no macOS pass is claimed.
- Logs: `/tmp/hiring-email-review/{tests-final,lint-final,sql,sql-unprivileged}.log`.
  No manual build/typecheck, dependency changes, metadata retrieval, production
  actions, provider calls or sends. Automatic preview diagnostics reported
  `build OK` at 2026-11-13T02:17:52Z; this is not deployed runtime evidence.

### Unrelated SDK commit inspection (read-only)

`b4bc67d1e43eeb52e1145d4b68e5f92a2b90fd2b` was outside the requested Hiring
scope. Its exact diff: package.json +1 pinned root development dependency
`@paperclipai/plugin-sdk: 2026.1012.0`; bun.lock +11 lines (root dev declaration,
SDK resolution and `@paperclipai/shared`, `three`, plus two nested `zod` resolutions);
AGENTS.md +1 dependency/check rule. No Studio source changed. Left intact.

Baseline tsconfig includes `src/**/*.ts`, including Studio test files importing
`packages/studio-research-coordinator/src/{signed-routes,host-admitted-routes,
preview-bootstrap}`. Those files import the SDK. The nested package already pins
the same SDK, but root install does not install that independent package's
dependencies. Thus the SDK must be resolvable for the existing full typecheck
graph on a fresh root install; a root declaration solves that. It is not required
by Hiring or evidence that the web bundler itself needs the SDK, and was not the
only possible remedy. No install, removal, Studio repair or build rerun here.

The prior automatic-build diagnostic below is historical, before that SDK commit;
it is not a current failure claim or fresh full-build evidence.

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