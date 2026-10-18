# Steward live workspace — precision artifacts

Approved reference: `approved-steward-current.png` (1586×992). Fidelity strategy: brand-consistent interpretation on real data — same hierarchy, proportions and density; no fictional fixtures in the live bundle.

## Design token block

- Colors: existing semantic tokens only — `card` (white panels), `secondary` (cloud rail), `border` (1px light blue-gray dividers), `primary` (royal blue actions/selected row tint), `success` (verified rows/counts), `warning` (amber score when partial), `destructive` (overdue), `muted-foreground` (metadata).
- Typography: existing brand fonts (Manrope/Sora via `font-display`). Meeting title 24–28px `font-display`; task titles 14px; metadata 12px; column headers 11px uppercase tracking.
- Spacing: 16–24px panel padding; 44px task rows; 8–12px gaps.
- Geometry: radii 8–12px (`rounded-lg`); 1px dividers; no large card shadows. Proportions at 1440: rail ~18%, main ~56%, detail ~26%.
- Effects: selected row `bg-primary/5` + left accent; verified row `bg-success/10`; score ring via simple SVG arc, amber until 100, green at 100.

## Component map

- `StewardWorkroom` (route `/modules/steward`, in `src/components/tt/steward/workroom.tsx`)
  - `MeetingRail` — search + meeting list, each with date, verified/agreed, coverage pill
  - `MeetingPanel` — title/date/participants/View meeting link, score card, proposal callout, filters (All/Open/Completed + search + owner), task table, bottom 100/100 remark
  - `TaskDetail` — right panel (desktop) / Sheet drawer (mobile): owner, due certainty, source evidence quotes, meeting source link, links to the existing review page for confirm/complete and meaning-reading
- `StewardTabs` — compact: Meetings (workspace), Team, More (Tasks, Agents, Scouts, Trust Tai AI, Timeline, Memory)

## Asset inventory

- No new imagery. BrandLogo via existing AppShell; lucide icons only.

## Data rules (real data only)

- Verified = commitment `status === "kept"` AND a valid current completion receipt (`steward_task_state` row for `commitment:<id>` with a parseable `completed_at` AND a `completion_note` of at least 10 trimmed characters). Kept-without-valid-receipt shows "Needs verification", never green. Source evidence quotations never qualify as receipts. Receipt-read errors surface as an alert; nothing is shown as verified on a guess.
- Released commitments leave the denominator; unconfirmed proposals are never in it and are labeled "unreviewed extracted passages".
- Coverage is separate from work progress. Coverage is "complete" only when a trustworthy source contract explicitly certifies it (`coverageConfirmed`); a non-empty transcript is never recording-complete and no timestamp heuristic is used. Today no stored Fathom record carries that contract, so coverage is always shown as not confirmed.
- Score = verified agreed work against the real denominator of confirmed promises. It never implies full transcript extraction, and it is capped at 99 unless every confirmed promise is verified AND coverage is confirmed AND no unreviewed proposals remain.
- Completion evidence in the detail panel shows the actual receipt (note, actor, time) separately from source quotations. History is explicitly unavailable in this view; absence of a queried timeline is not proof that no events exist.
- Auto-pull: while an authenticated Steward page is open (mount + window focus + 5 min interval, concurrent runs deduped per org+user), recent Fathom calls are read through the existing member-authorized endpoints and upserted through the existing `saveConversation` pipeline. Each incoming call is matched by an authoritative per-call lookup (`findConversationBySource`): exact equality on `source_external_id` (every candidate identity) or `source_url`, scoped to organization and provider, through member RLS — never a capped listing, so a match anywhere in the table is found and an older row is never duplicated. A failed or ambiguous lookup skips the write and reports an error. Zero-transcript reads are never stored over a full transcript; a late transcript upgrades a stored EMPTY one only, and the write carries the stored row's actual `source_external_id` so the upsert hits the same row (segment count alone never proves fuller). A disconnected source is an explicit 503, never a successful empty answer. `checkedAt`/last-success is set only when the source answered and every required write landed; a later failure retains the previous success and offers Retry. The pull is a bounded recent window (12 calls, 2 pages) and says so when older calls exist. No scheduler or webhook exists in this repository; closed browser = no sync, said plainly in the UI.

## Responsive plan

- 1440: three continuous columns (18/56/26) under a compact 56px header, 10–15 rows visible. 768: rail + main, detail in a Sheet drawer. 375: rail collapses into a drawer, compact title/meta/status rows, first actionable task in the first viewport. Sheets mount only at compact breakpoints, so desktop focus is never trapped; rows are real buttons with aria-pressed and visible focus rings.

## Refresh correction — 2026-10-18 (preview only)

- Equivalent ordered segment text, speaker, speaker email and timestamp are a normal successful `unchanged` read, with no write and no warning. Text/speaker whitespace is normalized; provider segment indexes, source links and meeting-title changes do not imply changed transcript content. Segment count alone never establishes equivalence.
- Changed nonempty stored transcripts, including shorter or empty incoming reads, remain untouched. `preserved` counts and concise expandable cautions are separate from failures; successful checks still show their checked time. Missing identity remains a caution; ambiguous/failed lookups, failed writes and source errors remain failures, never unchanged reads.
- No completion controls, manual-import changes, live record writes, permissions, migrations or publication are part of this correction.

## Completion persistence inspection — source only, not hosted verification

- Existing task completion: `src/data/steward/use-steward-actions.ts` wires `completeTask` in `src/data/steward/actions.ts:133–165`; `src/data/steward/authority.ts:28–45` applies task-origin/completion-path and owner/manager authority. It updates manual `steward_tasks` status or `commitments.status = kept`, then separately attempts receipt storage and an activity event. These writes are not atomic; receipt and activity failures are swallowed.
- The current meeting review route, `src/routes/modules.steward.meetings.$conversationId.tsx`, confirms proposals and records interpretation/correction outcomes; it does **not** wire completion or reopen. Existing workroom text suggesting completion happens there is therefore not a verified completion path. No UI correction or completion implementation is included in this inspection.
- `src/data/supabase/steward-task-state.ts:68–99` upserts `steward_task_state` on `organization_id,task_key` with completion actor label, timestamp and note. It is durable mutable current state, **not an append-only receipt ledger**. Workroom reads this table, keyed `commitment:<id>`, and requires kept status plus a valid timestamp and ≥10 trimmed note characters to verify. Receipt reads are capped at 1,000; missing schema currently returns an empty list. These are inspection findings, not changes.
- `src/data/steward/actions.ts:88–115` records `task.completed` through `src/data/supabase/activities.ts` with a stable per-task source event key. Activity delivery is best effort, not an authoritative append-only complete/reopen sequence. Workroom does not query that history and says history is unavailable.
- No durable Steward reopen action was found. Reopen in `src/routes/modules.steward.meetings.actions.tsx` is separate session staging; mockup reopen receipts in `src/domain/steward-preview.ts` are fictional in-memory events, not production evidence.
- Repository policy in `supabase/migrations/20260922090000_steward_task_state_and_role_app_access.sql` is membership-scoped and broader than app task-level completion authority. Hosted policy/schema state was not queried. Persistence, append-only complete/reopen evidence, atomicity/error handling and authority must be reconciled before adding workroom completion controls; no migration or access change was made.

## Correction verification

- `bunx vitest run src/data/steward/recent-sync.test.ts src/data/supabase/steward-service.test.ts src/components/tt/steward/workroom-receipts.test.ts src/domain/steward-workroom.test.ts`: exit 0, 38 tests passed (18 refresh tests).
- `bunx eslint src/data/steward/recent-sync.ts src/data/steward/recent-sync.test.ts src/components/tt/steward/workroom.tsx src/components/tt/steward/workroom-view.tsx`: exit 0.
- Standalone compiler/build commands were not run: current environment instructions prohibit manual project typechecks/builds; the harness validates automatically. Preview build log reported `build OK` at 2026-10-18T00:48:09Z; no standalone typecheck exit code is claimed.
- Browser-only fictional props verified successful checked time/unchanged count without Retry, changed-read caution expansion without Retry, and genuine failure with Retry. `/tmp/browser/steward-refresh/check_status.py` exited 0; screenshots `unchanged.png`, `preserved.png`, `failure.png` in the same temporary directory were inspected. No app harness route, committed screenshots or live data were changed; authenticated live refresh remains untested under the no-live-writes constraint.
