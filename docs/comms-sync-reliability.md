# Comms sync reliability — local candidate, not deployed

Current repair base: 6448e129bdad49e34ca136b35b62bf9f6f45bf66. The previously tested reliability candidate has been rebased into the isolated conversation-sync repair branch. Publication and deployment require separate approval.

## Changes

- Existing approved threads are loaded from every stored metadata page, not the newest 300 messages/threads. Organization and Gmail provider filters remain mandatory. Thread approval intersects stored mailbox provenance, with the existing sole-mailbox fallback for legacy rows. Missing ownership count or metadata read failures fail visibly. There is a 100,000-row safety ceiling; hitting it reports incomplete evidence instead of silently truncating.
- Existing 25-thread provider cap remains. Stable lexical round-robin uses cursor.approved_rotation.after, wrapping across the full eligible set so old conversations receive turns. Every fetched message must itself have the exact account-specific existing Trust Tai/Comms label before normalization or storage. A known sender, stored thread, or another labelled message does not authorize a new body. Missing label IDs fail closed. Cursor is committed only after message processing with an updated_at compare-and-set. A competing connection change causes a visible failed commit; it does not overwrite later cursor/status. Existing message writes remain idempotent and may have completed before a failed final checkpoint.
- Scheduler includes connected and error states, respects retry.next_at, backs off from five minutes to six hours (actual execution is the existing hourly cron). Revoked/disconnected states remain excluded. Temporary OAuth/network failures no longer mark the grant revoked; only explicit invalid_grant does. No new credentials or scope requests.
- Persisted last_run distinguishes success/partial/failed, with approved total/deferred counts and label_has_more. Partial passes retain the old last_sync_at. Approved-thread read failures no longer disappear as an empty watch list. Scheduler reports failed/partial/backoff-deferred outcomes with HTTP 503 instead of a blanket 200. The UI names bounded reads and deferred or partial coverage.
- Conversation history reads the newest 50 messages plus a one-row continuation sentinel, descending occurred_at/id keysets, displaying chronological order. Load older email traverses older pages; incoming new rows do not shift those cursors. Microsecond timestamp text is preserved. Linked-message independent reading remains intact. Other existing bounded consumers now receive the newest 200 rather than oldest 200.

## Access boundary

The existing Comms store is organization-shared, not mailbox-owner-private. This repair does not change RLS, memberships, app access, credentials, OAuth scopes or account settings. Apply an ingestion label only to message content authorized for the existing Comms audience. The Roadmaps read bridge separately verifies both current Roadmaps access and current Comms access before returning stored-mail bodies; authorization is rechecked before release.

## Remaining boundaries

The existing labelled-discovery cap (60 messages in the configured time window) is unchanged. Hitting it is now explicitly partial, but this candidate does not add resumable Gmail discovery pagination across scheduled passes or widen the two-day scheduled window. It cannot promise complete discovery after a long outage or an unusually busy labelled window. Review and separately authorize a bounded catch-up within the reviewed label set if needed. Fair approved-thread traversal does not authorize any unlabelled message, even within an existing stored thread. A separately reviewed import can include approved historical excerpts without changing Gmail labels or opening a whole thread to ingestion.

last_run is the current durable outcome, not an append-only run history. Checked metadata pagination is not a transactional snapshot; count checks detect many concurrent changes, not all same-count mutations. Final revision guard protects cursor advancement, not a global transaction over all historical writes. Larger production volumes should eventually use a dedicated per-mailbox approved-thread queue/lease and durable run ledger. The 5-second pg_net cron response timeout was not changed; durable integration outcomes remain the source of truth.

## Smallest next approval/action

1. Approve publishing this exact tested code candidate, without a schema migration or scope change, after checking the then-current production head and any concurrent RFP work. Do not invoke sync as part of deployment QA; existing scheduled sync remains responsible for normal passes after release.
2. For current inbox business correspondence, apply Trust Tai/Comms only to exact reviewed messages appropriate for the existing authorized audience, in the explicitly approved mailbox. Do not apply a thread-wide label or historical backfill without corresponding authorization. A separately approved bounded catch-up is a real ingestion/write and must not be bundled silently with deployment.
3. If the goal includes private personal mail, do not label/import the entire inbox into today's shared store. First obtain a concrete privacy decision and separately design/test owner-only mailbox/message authorization across RLS, read APIs, search, attachments, derived relationship data and UI. Existing broad Gmail readonly OAuth scope does not constitute approval to broaden ingestion.

No production sync, schema migration, deployment, push, permission change or message send is performed by this code candidate. Reviewed-data repair receipts are maintained outside the public repository. No claim of unrelated channel coverage is made.

## Prior candidate validation

The earlier isolated candidate passed the following checks before integration; these are not a substitute for rerunning the current combined repair.

865 Comms tests in 81 files passed, including real sync-pass orchestration with mocked provider/database boundaries, scheduler transient/backoff/revocation tests, 225-message pagination with timestamp ties and concurrent arrival, partial/deferred UI copy, and older-history controls. 60 RFP tests in five files passed on this newer base. TypeScript passed. Scoped eslint zero errors, three existing hook-dependency warnings. git diff --check passed. All provider actions and database writes in tests are mocked; only synthetic test environment values were supplied.

Supabase current changelog was checked (no applicable query breaking change for this code); raw or-filter syntax follows https://supabase.com/docs/reference/javascript/or and timestamp/id inputs are validated before interpolation. Existing package lock remains unchanged.

## Combined conversation repair validation

The current local candidate additionally merges reviewed Roadmaps correspondence with existing stored Gmail messages under the exact canonical relationship. It reads metadata in checked 500-row pages (10,000-row maximum per source), retrieves only 25 selected message bodies, and rechecks the Roadmaps association plus Roadmaps and Comms permissions before releasing content. Reviewed excerpts override duplicate stored copies by exact account/provider identity; unattributed legacy messages are omitted. No provider read or import is triggered by opening or refreshing this view.

The cursor hashes projected metadata, not body bytes. Normal collector enrichment changes its observation timestamp and invalidates pagination. A direct body-only database edit without a metadata change will not invalidate a previously issued cursor; an explicit refresh retrieves current text. This is a known limitation, not a claim of immutable historical snapshots.

Current checks: TypeScript and production build pass. The full browser-environment regression run passes 4,496 tests; eight failures across three suites reproduce unchanged on the verified base revision (brand-token assertions, Steward mock authorization and missing RFP readiness manifest). Three tests are skipped. The separate Node-only configuration checks pass 21 tests. Focused collector/quota checks and Roadmaps security, UI, refresh and pagination tests pass. These are local mocked checks, not proof of mailbox completeness or successful production release. No real credentials or client correspondence is included in added fixtures.

Publication remains held for explicit approval. Before release, recheck the connected branch, publish only the clean repair diff, then verify authenticated Roadmaps rendering and source provenance. Verify exact-message collector behavior only under separately applicable ingestion authorization. Do not use a known sender or an older labelled thread as permission to import a new message.
