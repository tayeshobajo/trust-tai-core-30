# Timestamp precision addition — local candidate awaiting expanded approval

This addition expands the previously approved Google Doc/evidence update. No production writes, push or publication have been performed. The previous approval covered two new reference/evidence tables, not the changes to existing submission timing below. Obtain confirmation for the combined candidate before applying either pending migration or publishing it.

## Behavior and historical evidence

Submissions now explicitly distinguish second, minute, date-only and unknown precision. The form starts with unknown; selecting minute/date exposes only the corresponding input. Minute evidence is stored as a normalized minute boundary plus explicit `minute` metadata, not as a claim that the event occurred at second zero. Its display excludes seconds and says seconds are unknown. Date-only evidence is stored in a date column, with no fabricated instant/timezone; unknown has neither date nor timestamp. Existing timestamp bytes remain untouched and are labelled legacy precision not recorded; the migration does not infer precision from trailing zeroes or reclassify historical rows.

Corrections are append-only amendments with a mandatory reason. NULL amendment precision means leave prior timing unchanged; explicit unknown is a correction that withdraws an asserted time. Latest timing is selected independently of later evidence-only amendments. Original records and timing corrections remain visible. Recording precision does not independently verify the source evidence. TWC/Iditarod imports have not been performed by this task.

## Exact added schema scope

Run `20261104214254_rfp_submission_time_precision.sql` AFTER the still-pending `20261104211202_rfp_document_references.sql`.

Added migration SHA256: `3fcbaf8e7ccf48c24121ca994187ca52ee3056098ecc3233872f56d54053626f`.
Original pending migration SHA256 remains `1309ea7e153b01d5a02300e2a0890e35609b41f8797cf989c5696bf907a0af78`.

The added transaction:
- Makes existing `rfp_submissions.submitted_at` nullable.
- Adds `submitted_date date` and non-null `time_precision text DEFAULT 'legacy'` to submissions. This classifies existing/older-client rows as unspecified precision without rewriting their timestamp values.
- Adds nullable `submitted_at`, `submitted_date`, and `time_precision` fields to the pending amendments table.
- Adds one CHECK constraint to each table, enforcing compatible precision/value combinations, past dates/times, and minute/second boundaries.

No new table, index, function, trigger, grant, role, ACL row, RLS/storage policy, credential, OAuth scope, Drive permission, file-sharing or opportunity-sharing change is introduced by this second migration. Existing SELECT/INSERT authorization and denial of UPDATE/DELETE continue to protect history. Existing exact timestamp columns/checks are retained where applicable. DDL locks require the normal migration window; do not blanket-push unrelated migrations.

## Compatibility and rollback (supersedes earlier rollback advice)

Apply both pending migrations before deploying the combined client. Older clients can still INSERT exact timestamps; omitted precision defaults to legacy. Older evidence clients omit correction fields, which means leave timing unchanged.

However, the old UI uses `new Date(submitted_at)` and is NOT a safe display rollback after new date-only/unknown rows exist: NULL can appear as epoch time. Any application rollback must retain the precision-aware renderer/types, or temporarily disable submission display/recording while preserving data. Do not fabricate timestamp values to satisfy old UI assumptions. Do not drop precision columns or new evidence tables after use. Migration failure rolls back its transaction; stop and inspect any uncertain outcome before retrying.

## Final local validation

- Full TypeScript exit 0; Vite production build exit 0.
- 58 tests across 5 files pass. Covers minute output/invalid seconds, date-only and unknown, invalid calendar dates, legacy display, unchanged evidence-amendment timing, and minute form submission.
- Fresh local PostgreSQL migrations and authorization harness pass, including upgrading synthetic existing history, minute/date/unknown insertion, legacy preservation, append-only timing amendment, invalid precision rejection, unauthorized writes, and previous document/file isolation tests.
- 28 Playwright viewport/state combinations at 390/430/768/1440 px pass, including minute/date/unknown submission forms and amendment dialogs. Zero axe WCAG A/AA violations, overflow or page errors. Targeted lint exits 0 with one unchanged export warning.
- Logs and explicit exits are in `qa/rfps/document-validation/`. No hosted write/upload test performed.

## Read-only production recheck

Live metadata and GitHub release branch both remain `11a1cc041a9362bdcfaa4a6f6bf486292474ab12`. Both new tables and submission precision columns are absent. Production has zero submissions, nine workspace grants and zero record-sharing grants. No production changes were made by this task. Earlier backup preflight reconfirmed completed physical backup November 4 10:05:51 UTC; refresh backup/live checks immediately before any authorized release.

Exact confirmation needed: approve applying BOTH named migrations to `okydosoacqdnursmmenf`, including nullable submission timestamps and precision metadata, then publishing this tested combined candidate through the existing CMD release branch/path. Existing record/file/Drive sharing remains unchanged. Authorization to deploy only the earlier two-table scope is not treated as approval of this expanded schema.
