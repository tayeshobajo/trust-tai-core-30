# Approved Steward atomic completion — blocked before implementation

Inspection date: 2026-10-18. Inspected HEAD:
`fe1bdacbca49a50d9f05d83d6325424e8d75eb08` (the requested read-only-history base).

## Application status

**Not applied to any database. No migration or completion UI was authored.**
The external target remains `okydosoacqdnursmmenf`; Lovable Cloud was not enabled.
The approved request requires exact hosted columns/constraints before code.
That prerequisite cannot currently be satisfied: the schema tool failed,
read-only CLI schema query and backend metadata lookup each exited 1 because
this project has no managed Cloud backend, and no managed PGHOST/database
connection is available. The external service API key is not a PostgreSQL
schema/migration connection; it was not used to bypass member authorization.

The repository contains no concrete previously reviewed
`transition_steward_commitment` SQL proposal. The user's approval is recorded,
but an invented implementation cannot be represented as that exact reviewed
change. Repository schema files are not a substitute for hosted inspection.

`docs/steward-atomic-schema-inspection.sql` is a read-only metadata request for
the existing database owner/operator. It contains no DDL/DML or private row
reads. Supply its results and the previously reviewed SQL proposal to unblock
exact-schema reconciliation without changing credentials or access.

## Confirmed source findings

- `docs/steward-v1-schema.sql`: commitments have org/conversation identity,
  `owner_user_id`, `source_app`, `source_provider`, `project_id`, `decision_id`,
  status (`open`, `waiting`, `kept`, `released`), and `updated_at`.
- `docs/steward-accountability-schema.sql`: mutable current receipt keyed by
  `(organization_id, task_key)`, with `completed_by_label`, `completed_at`,
  `completion_note`, `updated_by`, timestamps, focus and rank.
- `src/data/supabase/activities.ts`: expects org/app/event/actor/task identity,
  summary, payload, occurred time and `source_event_key`.
  `docs/ops-activity-idempotency.sql` documents a partial unique index on
  `(organization_id, app_key, source_event_key)`. Hosted existence is unverified.
- `src/data/steward/actions.ts`: status-first completion with swallowed receipt
  and activity failures is unsafe for this new view; it was not changed or used.
- `src/data/steward/authority.ts`: meeting-only, owning-room, owner/manager rules
  must be enforced in PostgreSQL, not merely copied as UI checks.
- `src/components/tt/steward/task-history.tsx`: selected UUID/org/Steward history
  stays read-only, limited to 50 events with explicit failed/unknown states.
- `src/components/tt/steward/workroom.tsx`: no verify/reopen controls were added;
  unchanged-transcript handling and automatic sync were not altered.

## Required isolated verification before application

Actual PostgreSQL 17.9 `postgres`, `initdb`, `pg_ctl`, and `psql` executables are
available. An isolated cluster can be created once the exact schema and reviewed
function are supplied. **No atomic database tests have run or passed.** Fabricated
constraints/policies would not certify the hosted transaction.

Required cases: row-lock concurrent stale transitions; expected status and
timestamp checks; owner/manager versus non-owner/view-only/cross-org denial;
blank/substantive evidence and acknowledgement; same-operation replay and
mismatched actor/target/payload rejection; injected receipt and activity failures
rolling back status and all writes; reopen retaining previous receipt history;
recomplete adding a new immutable event; unique operation events under retries.
All fixtures must be synthetic and isolated. No live commitment may be used.

After DB validation, the selected-task controls must call a single member RPC,
keep a stable operation UUID across uncertain-result retries, show no optimistic
verification, handle stale versions explicitly and invalidate only matching
org/user task, current receipt, workroom score and selected-task history queries.
These are pending requirements, not implemented or tested behaviors.

## Current Supabase reference

Inspected https://supabase.com/docs/guides/database/functions (fetch exit 0).
It recommends SECURITY INVOKER, explains caller versus creator privileges,
schema-qualified references with an empty search path, and default PUBLIC
execution requiring explicit revocation. The planned additive change must pin
search_path, revoke PUBLIC/anon execution, grant authenticated only, retain
existing RLS and add no tables/policies/grants beyond function execution.

## Verification scope

Existing selected-history, receipt, refresh and service regression tests are run
for preservation only. They do not validate an unimplemented atomic RPC.
`bunx vitest run src/components/tt/steward/task-history.test.tsx
src/components/tt/steward/workroom-receipts.test.ts
src/data/steward/recent-sync.test.ts src/data/supabase/steward-service.test.ts
src/domain/steward-workroom.test.ts` exited **0**, with **45 tests passing**
across five files. No TypeScript/UI/service implementation files changed;
changed-file source lint therefore has no applicable files and was not run.
The automatic preview log reported **build OK** at 01:15:21 UTC.
No UI changed, so no new screenshots were captured. Manual project compiler
and build runs remain prohibited by the environment; automatic preview
validation supplies build health, not an independently claimed compiler exit.