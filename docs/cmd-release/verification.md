# Isolated release verification receipt

Checked at 2026-10-04T22:54:00.583088+00:00

PostgreSQL 17.11 and PostgREST 16.4; synthetic records only; disposable Unix-socket database and loopback HTTP server. Complete harness exited 0; cleanup stops servers and removes cluster. No production operations.

55 SQL assertions passed; 6 concurrency/API groups passed.

- server stamps creator
- personal owner stamped
- classified primary identity immutable
- legacy cannot inject private child relationship
- legacy insert cannot inject board relationship
- historical rows preserved
- visibility immutable
- no automatic historical reclassification
- source metadata cannot spoof privacy
- member cannot reassign business work
- creator immutable
- blocker required
- dependency cycle blocked
- business dependency cannot expose personal work
- completion requires evidence
- open dependency blocks completion
- atomic completion receipt
- reopen retains prior receipt
- restore works
- classified hard delete denied by RLS
- dedupe key unique
- child cannot depend on parent
- mixed hierarchy dependency cycle refused
- unfinished child blocks parent completion
- nested parent refused
- private parent cannot be linked from business task
- goal cannot bypass confirmation
- backend cannot impersonate human confirmer
- other member cannot read private title or detail
- member reads shared business
- unrelated member cannot edit
- safe status aggregate works
- other member cannot confirm goal
- admin cannot read personal detail
- admin cannot confirm another goal
- child assignee cannot detach from parent they cannot edit
- assignee can update
- viewer can read business
- viewer cannot create
- inactive member cannot read
- inactive aggregate denied
- other workspace cannot read
- other workspace aggregate denied
- owner confirmation timestamp server-generated
- owner must reopen before rewriting confirmed goal
- other member cannot substitute confirmed outcome
- other member cannot reopen confirmed goal
- revised proposal has no confirmation receipt
- anonymous aggregate denied
- anonymous detail denied
- viewer cannot import
- approved import inserts exactly 22
- approved import retry does not overwrite
- import has no invented owners dates or receipts
- 13 audit children linked
- PASS concurrent opposite depends_on_task_id rejects one write without a committed cycle
- PASS concurrent opposite parent_task_id rejects one write without a committed cycle
- PASS concurrent imports create exactly 22 records
- PASS HTTP JWT owner-only personal detail; member/admin/viewer/inactive/cross-org/anonymous denied
- PASS HTTP count-only aggregate and workspace denial
- PASS HTTP viewer write and other-owner goal transition denial

Application suite rerun: 96 tests across 13 files passed. Existing app TypeScript/lint/build/browser checks remain applicable; no app code changed in this release-preparation phase.

GitHub main and Lovable latest both resolve to 334a766e9afd655b08ad8ebf1f381aeb9688beb5. Combined status returned no statuses; PR-filtered workflow endpoint returned no runs. This is no reported CI evidence, not green CI. Local branch has not been pushed.

Artifact hashes:

- migration.review.sql: `2a0b2a98fff9c20a67a0a8826ce7466650fbac3472829daa3a8e8fb592363208`
- import-helper.review.sql: `ad73bc50f17e1a2d64e1e697f9e0e59ed1719ce1c5c1ffb99428858fd691098e`
- cleanup.review.sql: `693c9771b2dfe5bcf988b51727bc1a45e5c857090f0881668c099b9b4972e4a3`
