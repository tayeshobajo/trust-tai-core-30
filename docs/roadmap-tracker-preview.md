# Roadmap Tracker preview

This is a read-only addition to Trust Tai Core's existing Roadmap home. Choose **Tracker** beside **Roadmaps**. It shows the verified source, lets a reviewer search and expand each row, and links existing canonical roadmaps to their evidence, exports and decisions. Mobile uses expandable row cards; desktop uses a table. No source workbook, database, approval, commercial state or delivery is changed.

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

The pure review functions describe an eventual apply boundary; **this release has no apply writer, migration, submit control, database import or automatic retry**. A later explicitly reviewed apply must be implemented and reviewed separately.

1. Persist reviewed bindings by file + sheet + stable source key + canonical roadmap and organization IDs. The initial snapshot assigns opaque keys once; row number is only evidence. A renamed or ambiguous row in a future snapshot requires reconciliation, not rematching by position or name. Multiple source identities targeting one roadmap are held.
2. Retain the immutable original snapshot, its file hash and source cells, plus every reviewed binding and row-level receipt in existing authorized persistence. Proposed narrow fields belong under `roadmaps.metadata.outreach_tracker`; preserve all unrelated metadata. The preview only models this namespace and never writes it.
3. Blank values are omitted from proposed changes. Differing existing facts produce conflicts, even if the source appears newer. `next_move`, owner, lifecycle, approval and commercial fields are not proposed changes.
4. Read the canonical row again before apply or retry. Compare both `updated_at` and a fingerprint of the inspected values. Receipt lookup returns a no-op for an already applied source row. A changed row or missing readback refuses the operation.
5. Future persistence must atomically compare-and-set the expected revision, preserve provenance and append the receipt/history. The pure eligibility check is not a transaction or a substitute for server authorization. No caller may use it alone as write permission.

Elevate A5:M5 preserves its old urgent action but is excluded from preparation. The sent message `1a0fe768c3425eb3` was verified on Tai's personal Gmail account: October 2, 2026 at 21:12:56 UTC, confirming the revised milestone hours, cost, priority and forecast. The reviewer can open that exact source. Neither the spreadsheet nor its history is rewritten.

## Outreach preparation boundary

All 12 rows remain blocked pending canonical identity reconciliation. No batch is created in this release. The pure preparation contract references an existing verified recipient and evidence, exact Comms draft/payload, sender, exact frozen export ID/version/digest and whether it is a preview or priced proposal, plus existing approval request/item/event IDs, revision, expiry and a one-send limit. Recipient, body, export kind/version and approval revision changes invalidate the fingerprint. Any prior delivery attempt, including failed or unknown, requires receipt readback. Existing Comms remains the only sender and must revalidate its live approval/delivery authority; this contract cannot dispatch.

## Verification and review handoff

Use `node_modules/.bin/vitest run --config vitest.tracker.config.ts` for the repository suite; pass the three tracker test files for focused checks. No database-backed smoke tests or sends are part of these tests.

- Focused domain, authenticated endpoint and rendered UI tests: 33 passed.
- TypeScript: `tsc --noEmit` passed.
- Build: `vite build` passed (preview output only).
- Changed-file ESLint: passed.
- Full repository tests: 3,745 passed, 15 failed in three unrelated suites during the initial run. See the task verification report for baseline comparison.
- Full lint contains pre-existing failures; the task verification report records the final counts.
- Desktop/mobile browser QA is not yet run: the separate TeamsynerG browser task remains active. Rendered interaction tests cover row expansion, search, blank fields, blocked send/apply and read errors, but do not substitute for viewport screenshots.

Base: Lovable project `65944e34-ede5-4757-befb-870e1ff97444`, commit `fa23e2ac2cc6a2dfcd19ecd87d3faa5e017dfbff`. Work is isolated from the user's dirty `/Users/tayeshobajo/Developer/trust-tai-core-30` checkout. Publication, live import, identity creation, new access grants, source workbook edits and outreach sends remain outside this preview.
