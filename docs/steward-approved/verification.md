# Steward review — 19 October 2026

## Scope and source

Base: `4f9ec9043d221986a3e5e764b47cebc197101933` on `tayeshobajo/trust-tai-core-30`, matching the authorized Lovable connector's latest revision for project `65944e34-ede5-4757-befb-870e1ff97444` (Trust Tai Core (30)). README and `__root.tsx` verify the project and cmd.trusttai.com identity. The source working tree had unrelated changes; this branch was created from a fresh isolated clone and origin/main. No reset or edits to the source checkout.

Both Library references were materialized onto this Mac through the supported Library helper and inspected as pixels: meeting overview `libfile_0b292fea5c5081919451d173c941c3a7`; task detail `libfile_f82d2481a2848191b19eb4a1ded472d5`, pinned version 2.

The existing AppShell, sidebar, menus, WorkspaceGate, authentication and authorization configuration are unchanged. The isolated browser harness renders that same AppShell with a fictional identity. The simplified mockup sidebar was not copied.

## Changes

- The existing Steward entry route opens a spacious meeting overview with search, three filters, date ordering, completion ratio/percentage, overdue/open counts and explicit zero-confirmed states.
- Meeting selection opens tasks; task selection opens a desktop detail panel or compact accessible drawer. URL selection preserves Back/Forward and deep links. Updates, Details and Evidence disclose information progressively.
- Completion is a separate pure projection: completed confirmed commitments plus immutable manually required tasks divided by all those obligations. Contextual linked business work, carried-forward projections and unreviewed candidates do not add denominator weight. Verification remains separately accessible through the original tools. Partial/capped task reads suppress percentages.
- Existing canonical board editing retains revision checks and validates blockers/evidence. Native commitment status changes use an updated-at/status compare-and-swap and original owner/admin permissions. Completion is deliberate and requires a result note.
- Updates use strict inserts into the existing activities contract: authenticated actor, timestamp, task identity and operation UUID. Duplicate retries verify the same payload. No schema-tolerant fallback may discard attribution or history.
- Roll-forward records a later date or accessible later meeting against the same task, preserving its agreed date, original meeting and source. A later meeting shows that same task as follow-up context excluded from its score. Original task status and denominator are unchanged.
- Existing advanced workroom and capabilities remain under More meeting tools; source/evidence tools remain available within the detail pane.

## Verification

- `npm run build`: passed (existing TanStack/Vite production build).
- `tsc --noEmit`: passed.
- Focused new suite: 20 tests passed (completion math, review/zero states, duplicate counts, roll-forward projection, filters, close/cancel, duplicate submissions, unavailable links, permission refusals, write failures and retry identity).
- Existing CMD suite: 112 tests passed, 14 files.
- Existing Steward suite: 120 tests passed, 17 files. One shell expectation was updated for the new empty-state copy; existing navigation and gate assertions remain.
- Disposable PostgreSQL integration: 2 tests passed. The real new persistence service ran through a psql adapter against temporary fixture tables with RLS. Verified inserted updates after a fresh reader, unique-operation replay, authorship, timestamps, roll-forward source/date/status retention, cross-tenant refusal, native completion persistence and stale completion rejection. The cluster used a private Unix socket and was removed after tests. No client tasks were touched.
- Live database checks were SELECT-only schema/index metadata, confirming required columns and `activities_source_event_key_unique`. No live task content or records were changed. The fixture policies test isolation but are not a replacement for a signed-in deployment smoke test.
- Browser checks at 1440, 768 and 375 pixels: search/filter, open, Cancel, repeated clicks, update refresh, Details/Evidence, Close, Back/Forward and no horizontal overflow. No page errors. Additional browser journey passed native status selection, explicit completion score recalculation, roll-forward reload/no duplicate counts and interrupted-navigation write targeting.
- Changed-file lint: zero errors; two fast-refresh warnings (one existing mixed-export file and the isolated fixture entry).
- Repository-wide lint remains blocked by existing baseline errors. A clean archive of the base revision reports 1,310 errors and 98 warnings. Unrelated lint failures were left unchanged.
- `git diff --check`: passed.

Screenshots and machine-readable browser results are in `screenshots/`. These contain fictional fixture data only. They show the preserved real suite sidebar/menu, not a replacement mockup shell.

## Review and publication

Local isolated review preview: `http://127.0.0.1:4176/qa/steward/index.html` while its Vite process is running. Start with `node_modules/.bin/vite --config qa/steward/vite.config.ts`. This harness is outside the application route tree and is not a production route. Its update reload test uses fixture localStorage; actual database persistence is tested independently by `bash qa/steward/persistence/run.sh`.

Browser runners in `qa/steward/` require Playwright in the runner environment; optionally set `PLAYWRIGHT_EXECUTABLE_PATH`. They block non-local requests. A temporary Playwright installation and an already-installed Chromium binary were used for this review.

No production deployment, schema migration, access-setting change, credential change or client/team message was performed. No Lovable browser sign-in was attempted; the authorized connector worked for read-only project identity inspection. The hosted Lovable preview still represents the base revision, not this branch.

Before publication: review the draft PR and screenshots, choose whether/when to merge into the Lovable-connected branch, rebuild its hosted preview, and perform a signed-in smoke test in an approved safe test context. Publishing cmd.trusttai.com remains a separate parent/user decision.

## Material limitations

- The existing reads are bounded: up to 60 meetings, 300 commitments and 1,000 business tasks. Scores are withheld when the task limit is reached; the overview states its meeting window. Update history shows the latest 100 entries, and capped roll-forward reads warn explicitly.
- Native commitment statuses remain the existing Planned/Open, Waiting and Completed/Kept contract. Canonical board tasks retain the full existing status set in their editor. No speculative status/schema migration was introduced.
- Native commitment status and its accompanying update are two existing database writes. If the status saves but the update fails, the UI explicitly reports partial success and asks the user to post the note on the completed task instead of repeating completion. No atomic-history guarantee is claimed. An atomic command would require a separately reviewed database migration.
- Evidence attachments and richer existing capabilities remain in the original tools; the new update composer posts text. No new attachment storage or permissions were introduced.
