> Subsequent precision addition: see [TIMESTAMP-PRECISION-APPROVAL.md](TIMESTAMP-PRECISION-APPROVAL.md). Its expanded migration scope and rollback requirements supersede the original scope below. Final combined validation is 58 tests and 28 browser checks.

# Google Doc references and submission evidence — review candidate

## Behavior

- Link a Google Doc from the proposal panel or sidebar. The title, canonical document URL and note are stored under the existing opportunity ACL. No Google API, OAuth, document-content fetch, sharing change, preview embed or automatic upload occurs. Opens in a new tab without referrer/opener access.
- PDF/DOCX/TXT private uploads remain unchanged. Google Docs are explicitly mutable working references, never approved immutable draft versions. To preserve bytes, export and upload the submitted PDF.
- Record an external submission using the existing action. For a Google Doc submission, then choose **Add / correct evidence**, select the related Doc, identify the actual submitted named revision/version (team-reported), optionally attach the preserved uploaded file, and record the receipt/reference/URL. A link alone does not establish submitted contents or delivery.
- Historical missing evidence remains unknown and can be corrected at any time with append-only amendments. Every amendment contains the current evidence fields and a mandatory reason; older amendments and original submission remain visible. A database identity sequence orders amendments deterministically, including equal timestamps. This is a team evidence ledger, not independent delivery verification.
- Linking the wrong working document is corrected by adding another reference; the original reference remains in history. No edit/delete operation was added.

## Code and database

- Domain: `src/domain/rfps.ts` URL allowlist/canonicalization, evidence schema and types.
- Data adapter: `src/data/supabase/rfps.ts` loads references/amendments and writes through authenticated Supabase/RLS.
- UI: `src/components/tt/rfps/workspace.tsx` labelled forms, explicit mutability and unknown-evidence copy, amendment history, keyboard tabs.
- Migration: `supabase/migrations/20261104211202_rfp_document_references.sql` creates two RLS tables, invoker-trigger timestamps, identity sequence, indexes and composite foreign keys. Grants only authenticated SELECT/INSERT, with existing membership/workspace/opportunity predicates. No ACL, existing record, Storage policy or Drive permission changes.
- The migration adds a composite unique constraint to submissions for evidence linkage. It does not change existing submission values or grant UPDATE/DELETE. Review normal migration lock implications before release.

## Validation

- Local PostgreSQL 17, synthetic fixtures only: original security harness and new `qa/rfps/document-policies.sql` pass. Creator writes, viewer reads but cannot write, same-org unshared and cross-org isolation, anonymous denial, author spoofing, timestamp forging, URL constraints, immutable history, and separate submission/document/file cross-opportunity FK checks. Existing restrictive Storage policies tested against simulated permissive legacy policy.
- 54 tests across 5 files pass (`vitest --config vitest.rfps.config.ts`). New cases exercise URL rejection/canonicalization, honest evidence gaps, link workflow and historical amendment workflow.
- Full `tsc --noEmit` and production Vite build pass. Targeted ESLint: 0 errors; one pre-existing component-file export warning. Build retains existing unrelated TanStack inputValidator deprecation warnings.
- 16 Playwright state/viewport combinations, widths 390/430/768/1440: no horizontal overflow, browser errors or axe WCAG A/AA findings. Tested draft panel, link dialog, submissions, amendment dialog; Escape closes dialogs. Dialog animations are finished before contrast measurement. Screenshots at 390 px are synthetic only. Manual screenshot inspection confirms labelled scrollable mobile forms.
- Evidence logs in `qa/rfps/document-validation/`, browser results and screenshots alongside harness. Browser runner accepts PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE; it uses an already installed browser, no download.

## Baseline and release needs

This isolated worktree integrates local released RFP commit `af7b8ebc` and latest local Comms production release `11a1cc04`. Diff against `11a1cc04` contains only this feature and its QA/docs. Read-only recheck on November 4 confirmed both the remote release branch and live public build metadata still point to `11a1cc041a9362bdcfaa4a6f6bf486292474ab12`; recheck immediately before integration. No push or deployment performed.

Production requires explicit approval of this additive migration and application release. Apply the new migration only (the original RFP schema is already installed under a different production migration version), review hosted advisors and migration history, then release the application. The new client expects both tables and fails closed if they are absent. Preserve tables/history when rolling application code back. No production migration, client file upload, production data mutation or authenticated hosted round-trip was performed. Read-only production schema and security-advisor inspection was subsequently completed; existing unrelated advisor findings remain, with no RFP findings. The local SQL harness models auth/membership/storage; it does not claim an end-to-end hosted Supabase/PostgREST/Storage test.

Supabase guidance reviewed: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/changelog . Markdown fetch was unavailable; HTML documentation used. CLI telemetry disabled locally after default telemetry attempted a sandbox-protected home write. No credentials or grants created. Disposable local PostgreSQL required sandbox escalation for shared memory/socket access and was approved.


## Corrected final verification and approval scope

The initial validation report incorrectly called TypeScript successful. Its saved log contained TS2345 in the keyboard tab handler. The final candidate now guards an absent indexed tab before calling setTab, with a regression test for arrow wrapping, Home/End, selection and focus. On the corrected source, all commands completed with exit 0: full TypeScript, Vite production build, 54 tests, targeted lint (one existing warning), fresh local PostgreSQL authorization harness and 16 Playwright viewport/state checks. This section supersedes the initial incorrect result. No application/schema changes followed those checks.

Read-only live preflight reconfirmed the original six RFP tables, original production migration `20261104204026`, nine workspace grants, zero opportunity-sharing grants, and zero submissions. Both new tables and the new submission constraint are absent, so the additive migration has no name collision. Existing RLS/helpers were inspected during the preceding preflight and satisfy its dependencies.

Exact proposed production operation, pending user approval: apply only `20261104211202_rfp_document_references.sql` (SHA256 `1309ea7e153b01d5a02300e2a0890e35609b41f8797cf989c5696bf907a0af78`) to `okydosoacqdnursmmenf`, verify schema/RLS/advisors read-only, then push the corrected reviewed application candidate to the existing CMD release branch and publish through the existing CMD deployment path. Do not blanket-push historical migrations. No such operation was performed.

The migration creates two tables with constraints, indexes, RLS and four scoped policies; two triggers reuse the existing invoker timestamp function; one identity sequence orders amendments; one composite unique constraint is added to submissions. It revokes default privileges on the new tables, grants authenticated SELECT/INSERT plus sequence USAGE, and relies on existing active-member/workspace/opportunity authorization. These are persistent new-feature grants, not changes to existing membership or sharing ACLs. No UPDATE/DELETE grant, OAuth, credentials, Drive sharing, Storage policy or file/record-sharing change is proposed. Link metadata follows opportunity visibility; underlying document access still depends on Drive.

Deploy database first. The old application tolerates the additive schema; the new application requires both tables. Application rollback targets live `11a1cc04` while preserving all new tables/history. Transactional migration failure rolls back DDL. The latest completed physical backup was reconfirmed at November 4 10:05:51 UTC; PITR was previously reported disabled, not independently reconfirmed. A physical restore is not the normal rollback and could lose unrelated later data. Hosted authenticated write/upload verification remains outside completed validation.
