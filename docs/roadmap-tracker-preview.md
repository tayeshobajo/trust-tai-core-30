# Roadmap Tracker preview

**Roadmaps** is a first-class item in Trust Tai Core's main navigation. Choose **Tracker** on the existing Roadmap home. Existing canonical records can be edited by members who already have Roadmap work access; the workbook import remains a separate read-only review. Desktop uses a table and mobile uses cards. This preview does not import the workbook, create identities, grant access, publish, approve or send outreach.

## Verified source and identity boundary

- File: `1kr0sb0LQAaJbm-HtUauQW6WUFQkCKjt9`, **Trust-Tai Roadmap Proposal Tracker.xlsx**.
- Modified: `2026-10-14T14:21:27.087Z`; sheet **Roadmap Tracker**, header A4:M4, source rows A5:M16.
- Original XLSX SHA-256: `edd238c355030f1072f9d9ad17a19a1358c93ba5a7846716938f5ee078cee7c3`.
- Historical file `1PwDbLfOugDaRK3oBrA4Vhyg60HJhvjI4` is not used.
- Twelve source rows: Elevate, Real Leaders, Spartan, Rollick, JD Genius, SB Reads, PTT, ePay, SmartSof, SASE, Rejuvenate, Sherri Clarke.
- Live read of `okydosoacqdnursmmenf.public.roadmaps` found only Mental Dental, Northlight Systems and Teamsynerg. None establishes a canonical roadmap binding for a source row. No binding is inferred from a name, and no record is created.

The source is packaged only in a `.server.ts` module, never a public fixture or fallback for a failed database read. Its GET endpoint validates the user through Supabase Auth, active membership in the exact source organization, organization app settings, member overrides and role defaults through the existing `resolveAppAccess` rule. It uses the public key and caller token under RLS; errors fail closed. Responses use `private, no-store`. Client query identity includes organization and user; session identity is checked before and after the read.

## Field ownership

| Source column                  | Review behavior / later destination                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Project / Roadmap              | Original name plus file/sheet/source key/physical row evidence; reviewed binding to existing `roadmaps.id`. Never a create instruction.   |
| Priority                       | Narrow tracker field `priority`; blank means unknown.                                                                                     |
| Roadmap Stage                  | Tracker `pipelineStage`, preserving all nine spreadsheet values. Never passed to `roadmaps.status`. Imported Approved grants no approval. |
| Comms Channel                  | Source `channel`; existing Comms owns actual delivery channel and touches.                                                                |
| Current Conversation Position  | Source `conversationPosition`; compare with existing Comms evidence.                                                                      |
| Client Signal                  | Tracker `clientSignal`, unknown when blank.                                                                                               |
| Key Links                      | Original `keyLinks`; review references to existing research/evidence, artifacts, versions and exports before attaching.                   |
| Date Sent                      | Source `dateSent`; cannot establish priced proposal delivery or a provider receipt.                                                       |
| Last Update Date               | Source `lastMeaningfulUpdate`; never substitute workbook modification or preview/import time.                                             |
| This Week's Goal / Next Action | Historical `nextAction`; never silently replaces canonical `next_move`. Requires reconciliation.                                          |
| Date Closed                    | Source `dateClosed`; does not establish payment.                                                                                          |
| End-of-Week Status             | Tracker `endOfWeekStatus`.                                                                                                                |
| Conversion Turnaround (Days)   | Original `conversionDays`; blank stays unknown, explicit zero stays zero.                                                                 |

All columns remain visible in source review, including blank cells. Eleven priorities and actions are blank. Every source date, signal, channel and link is blank. The UI reports **No recorded closed outcomes**, with unknown win rate and turnaround. Payment stays outside this tracker: the existing commercial services and real receipt evidence remain authoritative; invoices, signed value and Closed - Won do not mean paid.

Existing `owner_user_id` and `next_move` remain canonical. Evidence/Exports links enter the existing roadmap workspace, where `roadmap_research`, evidence, `roadmap_artifacts`, `roadmap_artifact_versions` and frozen `roadmap_exports` remain owned. Comms and Approvals links enter their existing modules. No parallel entities or approval tables are introduced.

## Reconciliation and later apply contract

The pure review functions describe an eventual apply boundary; **this release has no workbook apply writer, migration, import submit control, database import or automatic retry**. A later explicitly reviewed apply must be implemented and reviewed separately.

1. Persist reviewed bindings by file + sheet + stable source key + canonical roadmap and organization IDs. The initial snapshot assigns opaque keys once; row number is only evidence. A renamed or ambiguous row in a future snapshot requires reconciliation, not rematching by position or name. Multiple source identities targeting one roadmap are held.
2. Retain the immutable original snapshot, its file hash and source cells, plus every reviewed binding and row-level receipt in existing authorized persistence. Proposed narrow fields belong under `roadmaps.metadata.outreach_tracker`; preserve all unrelated metadata. Manual tracker edits use this namespace now; source import receipts and bindings remain review-only.
3. Blank values are omitted from proposed changes. Differing existing facts produce conflicts, even if the source appears newer. `next_move`, owner, lifecycle, approval and commercial fields are not proposed changes.
4. Read the canonical row again before apply or retry. Compare both `updated_at` and a fingerprint of the inspected values. Receipt lookup returns a no-op for an already applied source row. A changed row or missing readback refuses the operation.
5. Future persistence must atomically compare-and-set the expected revision, preserve provenance and append the receipt/history. The pure eligibility check is not a transaction or a substitute for server authorization. No caller may use it alone as write permission.

Elevate A5:M5 preserves its old urgent action but is excluded from preparation. The sent message `1a0fe768c3425eb3` was verified on Tai's personal Gmail account: October 2, 2026 at 21:12:56 UTC, confirming the revised milestone hours, cost, priority and forecast. The reviewer can open that exact source. Neither the spreadsheet nor its history is rewritten.

## Outreach preparation boundary

All 12 rows remain blocked pending canonical identity reconciliation. No batch is created in this release. The pure preparation contract references an existing verified recipient and evidence, exact Comms draft/payload, sender, exact frozen export ID/version/digest and whether it is a preview or priced proposal, plus existing approval request/item/event IDs, revision, expiry and a one-send limit. Recipient, body, export kind/version and approval revision changes invalidate the fingerprint. Any prior delivery attempt, including failed or unknown, requires receipt readback. Existing Comms remains the only sender and must revalidate its live approval/delivery authority; this contract cannot dispatch.

## Editing existing roadmap records

The editor saves only validated tracker-owned fields and the canonical `owner_user_id` / `next_move`. Pipeline stage never changes `roadmaps.status`, approval authority, artifacts, exports, delivery or commercial facts. Explicit manual clearing records unknown; imported blanks remain unable to erase data. Last meaningful update is entered separately from save time.

`GET/PATCH /api/public/roadmap/tracker` uses the caller token and publishable key under existing RLS. Every save rechecks active membership, app visibility and work permission, and validates a newly assigned owner as an active accessible member. No service-role credential, new grant, RLS change or migration is included.

Each operation has a UUID and a fingerprint bound to the actor, roadmap and exact patch. Saves compare the inspected revision, then conditionally update the same canonical row against `updated_at`, metadata, owner, next move and lifecycle status. The same atomic row update appends before/after edit history under `metadata.outreach_tracker.edits`, preserving unrelated metadata and any source receipts. A readback checks the operation receipt even when the update response is lost. Repeating the operation acknowledges the receipt without applying another edit. Conflicts retain the draft and require review; keeping the draft rebases only explicitly edited fields.

The existing `activities` stream receives the operation UUID and provenance after the row is confirmed. If that mirror fails, the durable row history remains visible and the UI reports the history-sync warning; checking saved state retries only the mirror. This is operational edit history using existing permissions, not a new immutable or tamper-proof audit store. No direct Supabase writes were made during development or verification.

### Reconciliation result

Read-only verification against the configured backend and Trust Tai organization found the same three native roadmaps: Teamsynerg, Mental Dental and a seeded Northlight Systems record. None binds the twelve workbook rows. Nine source names have supported existing Comms relationship/contact candidates: Elevate, Real Leaders, Spartan, Rollick, JD Genius, SB Reads, ePay, SASE and Rejuvenate. Six of those relationships are archived, and all lack client/prospect bindings; they are evidence for review, not approved recipient or canonical bindings.

PTT Anywhere and Sherri Clarke Nutrition have external document/email evidence but no corresponding native identity. SmartSof remains ambiguous between SmartSoft USA/PressWise/Data Quality and Smartsoft International. No companies, contacts or roadmaps were created or reactivated. The task's reconciliation handoff contains candidate UUIDs and per-row evidence references; no candidates are applied automatically.

## Verification and review handoff

Run `node_modules/.bin/vitest run --config vitest.tracker.config.ts`. Focused files are `roadmap-tracker.test.ts`, `registry.test.ts`, `roadmap-tracker.server.test.ts`, `roadmap-tracker-edit.server.test.ts`, `tracker.test.tsx` and `editor.test.tsx`.

- Focused tests: 75 passed, covering source safety, permissions, validated edits, identical retries, stale/concurrent changes, lost responses, history recovery, stage separation, unknown/zero and retained drafts.
- TypeScript, production build and changed-file ESLint: passed.
- Full repository tests: 3,792 passed, 15 failed in three suites already failing at baseline (`brand-contract`, `comms-review-lessons.server`, `scout-import.server`).
- Full lint: 1,394 errors and 97 warnings, matching the baseline.
- Isolated headless UI: real tracker components at 1440px and 375px, with fixture-only persistence. Confirmed stage/action/date saves, visible saved status and before/after history; mobile document width equals viewport width. Screenshots are in the task verification folder. Native date-picker automation was unreliable; date entry was verified using native DOM input events and form/server tests.
- No authenticated live database write smoke test was run. Live customer records and the source workbook were not changed. The separate TeamsynerG browser session was not used.

Existing Lovable project: `65944e34-ede5-4757-befb-870e1ff97444`. Work is isolated from the user's dirty `/Users/tayeshobajo/Developer/trust-tai-core-30` checkout. Publication, live import, identity creation, new access grants, source workbook edits and outreach sends remain outside this preview.
