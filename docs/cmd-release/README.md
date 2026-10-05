# CMD controlled release — prepared, not applied

Tai approved shared business/private personal/own-goal access (Sentinel_b768275ff4e481919eee019319537a10) and scoped existing/production database changes (Sentinel_c8917785250081918400eb8baae41dda). This authorizes the corresponding safe migration/import after permission regressions pass. It does not authorize installation, destructive fixtures in production, broader access or historical reclassification. No further business decision is required for this slice.

## Reproducible artifacts

Run `python3 docs/cmd-release/build.py` to validate the prepared set and reproduce these files without database access. Source SHA256 hashes are embedded.

- `migration.review.sql`: one transaction; five-second lock timeout, sixty-second statement timeout; locks task/goal tables; rejects already-applied or unexpected baseline policies/RLS. Applies both reviewed drafts with their inner transaction boundaries removed. Compares all original task and goal values before/after; all original tasks must remain legacy_shared. An assertion failure aborts the transaction. This intentionally rejects policy drift instead of guessing how to accommodate it.
- `import-helper.review.sql`: installs one temporary SECURITY INVOKER RPC. Only a verified active owner/admin can invoke it. Its fixed payload contains precisely 22 business tasks, with owners/due dates unset, no delivery receipts, and thirteen audit parent links. One invocation is atomic. Existing matching keys are returned without updating them; ambiguous keys or unexpected scope/source/parent abort the whole invocation. The database stamps the actual authenticated creator; creator is not an invented assignee.
- `cleanup.review.sql`: drops the temporary RPC after successful import/readback. It grants no lasting data access. The helper only exposes the same fixed business writes an existing admin can already make under the approved model.

The application has no new dependencies. Updated prepared next actions acknowledge access approval and the already-supplied audit checklist. Other work remains at its supplied status; no task is marked delivered by this release script.

## Required order and stop conditions

1. Installation separately approved and completed: `/opt/homebrew/opt/postgresql@17/bin` (17.11), `/opt/homebrew/opt/postgrest/bin` (16.4). Existing libpq links were preserved; two version-specific PostgreSQL resource links completed the installation. No persistent service was started. Never point isolated tests at production.
2. Rebuild artifacts and run `CMD_PG_BIN=<complete-bin-directory> docs/cmd-task-manager-tests/run-db-tests.sh`. It now exercises the exact migration wrapper and import helper, including role-switched permission and idempotent import assertions. The exact wrapper/import and two-session opposite dependency/parent-edge and duplicate-import races now pass; see verification.md. The harness also performs real JWT/PostgREST role/privacy checks. Inspect lock timeouts/deadlocks as failed operations, not successful writes. Unit mocks do not substitute for these checks.
3. Verify exact remote baseline, latest branch diff, CI, database policy inventory and no other publisher. Resolve any drift locally; do not merge unrelated PORTAL or payment work. Preserve a restricted pre-migration schema/policy backup and database recovery point through the authorized database's existing backup facility. Do not export private titles to logs or repository.
4. Apply the exact tested migration transaction through the authorized migration channel. Read back columns/policies/triggers and original aggregate counts. A migration error means stop; no import/publication follows it.
5. Install the tested helper; invoke it through the verified owner's actual authenticated Supabase session with the verified organization UUID. Never manufacture JWT claims or put tokens in shell/logs. Retain the returned 22 IDs/keys/inserted flags as a restricted release receipt, verify record/parent counts, owner/date nulls, and zero complete statuses, then remove the helper. An interrupted client can retry the same RPC without resetting human edits.
6. Coordinate the sole publisher with parent, verify the exact remote SHA and CI, publish via Lovable, then perform the authenticated checks below. Do not call the task delivered before live checks pass.

## Recovery — no irreversible deletes

Before transaction commit, any migration/import failure rolls back that transaction. Migration and import are separate deliberate boundaries; a successful migration does not imply a successful import.

After commit, retain the privacy guards even if the UI must revert. Redeploy the prior app revision if needed; do not restore broad legacy policies over classified personal records, drop task columns, or delete records. Remove the temporary import helper immediately on an import problem. Correct an erroneous imported row only by an authorized editor with a fresh revision check. To withdraw the batch, use the recorded inserted IDs, verify their current revisions and scope, then archive those records through the existing authorized archive path; do not archive pre-existing retry matches or silently overwrite subsequent edits. Restore via the archived view. Existing legacy rows are never part of batch recovery. A schema defect needs a reviewed forward fix retaining privacy and recorded data; no broad rollback SQL is supplied because it would risk exposing personal work.

## Actual authenticated acceptance checks

Use existing authorized accounts/sessions; do not invite users or widen roles for QA. Perform synthetic member/admin/viewer/cross-org/anonymous scenarios in the isolated environment. Production verification uses only approved real records and avoids destructive test fixtures.

- Owner desktop: Home opens task board; the 22 records and thirteen audit children show supplied statuses, actual creator/verified assignee labels, next actions and blockers. No assigned owner/due date is invented. Source links remain sources; planned criteria remain separate from checked receipts.
- Owner private: personal details appear only for their owner. In a second existing member/admin session, query the actual API as well as the UI: another person's personal IDs/titles/notes/evidence must not return. Count-only RPC returns only owner UUID/status/count. Verify inactive/cross-org/anonymous denial in isolated API tests.
- Business writes: creator/assignee/admin may edit within existing roles; unrelated members/viewers cannot. Only admin reassigns business owners; personal ownership never transfers and has no admin detail override. Confirm denial through API, not disabled controls alone.
- Weekly goal: only owner can confirm/reopen; confirmed content cannot be substituted while keeping confirmation. Other member/admin/service attempts must fail in isolated SQL/API tests. Do not confirm a real goal on the user's behalf merely for QA.
- Workflow: verified real authorized edits survive refresh and a new session; stale revision writes fail; retry create does not duplicate; archive/restore remains recoverable; blocked work displays its reason; unfinished dependencies/children prevent delivery; checked receipts stamp actor/time. Do not mark real work complete solely to test the control.
- Desktop and actual mobile viewport: keyboard opens editor, title gains focus, Tab stays usable, Escape closes and restores focus; no horizontal overflow; source links and dropdowns usable. Check loading/error/empty handling with isolated synthetic data/network conditions, not by altering production task state.
- Live proof: verify authenticated cmd.trusttai.com serves the exact intended commit behavior, not a cached app/published badge. Record date, account role (no credentials), viewport, result and source receipt. If an existing second-user session is unavailable, report that verification limitation and keep delivery pending.

## Current evidence

Application suite: 102 tests across 14 files; previous TypeScript/lint/build and synthetic Chrome checks pass. The latest generator and shell syntax checks pass. SQL permission/import/concurrency and JWT/PostgREST checks now pass; see verification.md. The tested access migration and scoped import helper are now applied. No production task import, push or publish has occurred; see verification.md.
