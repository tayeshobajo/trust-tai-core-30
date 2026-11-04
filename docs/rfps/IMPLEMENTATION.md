# RFPs & Grants — staged first version

Built from production source `codex/cmd-roadmaps-preview-source`, verified base `e0dbd8d370a4c8447d77d03910455f69bfaa2991`, in branch `feat/cmd-rfps-grants`.

## Delivered

- First-class `/modules/rfps` route, existing CMD shell and organization/app gate; dedicated `rfps.read` / `rfps.write` capabilities. No Roadmaps or Comms implementation changes.
- Screenshot-directed list → detail → action layout using existing design tokens. Responsive empty, loading, unavailable, read-only, populated, modal and offline states. Counts derive from authorized records; filters and selection agree. No production fixture data or preloaded grants.
- Independent opportunities with RFP/grant type, issuing source, source URL and captured evidence, application cycle, applicant legal entity, eligibility plus notes, requirements, deadline date/time/IANA timezone, named owner, next action and workflow stage.
- Unknown eligibility/timezone/deadline stay unknown. RFP requirements and grant restrictions receive distinct labels. Exact deadline time requires timezone; date-only deadlines do not silently become midnight.
- Source URL canonicalization strips marketing parameters/fragments, sorts query keys and strips trailing slash. Server canonicalization plus organization/source/cycle uniqueness catches concurrent duplicate captures; different sources for the same opportunity still need human review. Host aliases/redirects are not resolved.
- Shared editing uses optimistic revision checks. Ready requires an applicant, eligible review and approved draft. Submitted/awarded/declined require an actual submission record.
- PDF/DOCX/TXT draft upload adapter, 20 MB maximum, SHA-256 metadata, private storage, immutable version records; latest, approved and recorded-as-submitted are separate labels. Download to view; no inline rendering of untrusted documents or public URLs. Failed version metadata after upload reports an orphan for administrative reconciliation.
- Immutable draft approval and external submission records. A historical submission may have no recoverable draft or receipt; it is explicitly marked evidence pending. Recording a submission never sends anything or claims delivery/acceptance. Workflow stage is changed separately after reviewing the record.
- Manual daily discovery review log with source descriptions/URLs, counts and failed counts. Automated feed, coverage and freshness remain explicitly unconnected/unknown. Scout watchlists are not reused as an RFP feed.

## Access model and staged migration

`supabase/migrations/20261104194348_cmd_rfps_grants.sql` is generated with the installed CLI and **has only been applied to isolated local test databases**. It creates new tables and one private `rfp-drafts` bucket. No production records, policies, bucket settings or app access have been changed.

Two database grants must be explicitly provisioned by an authorized administrator:

1. `rfp_access` workspace row: organization UUID as `scope_id`, user UUID, `view` or `work`.
2. An opportunity UUID as `scope_id` for each shared opportunity. The creator can access their own records while retaining workspace access. Other users require both workspace access and the specific opportunity grant. A view grant cannot upload or edit even if the user belongs to the same organization.

Existing active organization membership remains mandatory through `private.is_org_member`. Browser roles cannot create or change these ACLs. No ACL rows are seeded by the migration. The existing CMD organization-app switch and per-person/role access must also be reviewed for `rfps`; UI permission does not bypass database authorization. No settings have been enabled automatically. To revoke database access, remove or narrow the corresponding `rfp_access` grant; hiding the room in CMD alone is not a database revocation.

All new tables have RLS; anonymous access is revoked. Child records and storage objects are scoped through the authorized opportunity. Storage insert permits new objects only. Restrictive bucket-specific guards prevent legacy permissive policies from widening read/upload access or permitting overwrite/delete. History is append-only; opportunity identity and creator are immutable. Server timestamps prevent browser-authored history dates, while submitted_at remains the explicitly reported historical time. Functions use security invoker; no new security-definer function or service-role client was introduced.

## Known limits / still unconnected

- Daily search ingestion, scheduling, notifications, retries and source health probes are not implemented. Manual review notes do not update individual source availability. Current searches remain external.
- Team grants are administrative; there is no in-app sharing editor. Owner is a named responsibility label, not a validated directory assignment or notification target.
- No production storage transfer or signed-in hosted end-to-end exercise was performed. Local SQL tests use minimal auth/storage tables, not a complete Supabase storage server. Full staging validation and Supabase advisors remain release gates.
- Drafts download for viewing; there is no collaborative editor, diff, malware scanning, retention/purge workflow, or approval revocation UI. Any authorized worker can record a draft approval; no two-person review rule is claimed.
- Submission evidence is a URL/reference, not an uploaded receipt. Immutable submissions cannot yet receive an attached evidence amendment through the UI; a follow-up evidence workflow should precede heavy historical backfill. Award outcomes are manually reported stages, not verified funder decisions.
- Lists fail explicitly above 500 records per table; server pagination is required at larger volume. Source equivalence beyond canonical URL + cycle is human review. There is no automatic opportunity-to-Roadmap conversion.
- No production access expansion, application submission, third-party account creation, automation, push or deployment occurred.

## Verification

- TypeScript: `tsc --noEmit` passed.
- Production Vite build passed (existing unrelated TanStack inputValidator deprecation notices).
- Focused tests: 30 passing, including source normalization, unknown values, timezone requirements, submission future-time rejection, file constraints, list/detail consistency, unavailable-state counts, read-only controls and registry route placement, and existing app-access regression coverage.
- Local PostgreSQL 17: migration applied from scratch; creator access, same-org unshared isolation, shared-viewer read/no-write, cross-org isolation, private storage authorization, immutable versions, duplicate constraint, immutable opportunity identity, submission gating tested, including a simulated legacy broad storage policy. Test-only identities/data are confined to the local PostgreSQL instance.
- Browser: 20 state/viewport combinations across 1440, 768, 430 and 390 px, no horizontal overflow or browser errors. Escape closes the modal. Axe WCAG 2/2.1 A/AA scan found zero violations in the populated component view. Synthetic QA fixtures are labeled and confined to `qa/rfps`, never loaded by the production route.
- Screenshots: `qa/rfps/detail-1440.png`, `detail-390.png`, plus other viewport/empty states. Browser results: `qa/rfps/browser-results.json`.
- Supplied image was materialized using the Library-supported transfer helper and inspected as pixels; reference identity `libfile_79408c7db4988191b90a0f336bc17af8`. No copy of its illustrative example records was inserted.
- Checked repository AGENTS.md (preserve published history), local Codex memories directory (empty), Production Mode Tier 1, Library and Supabase skills. Current Supabase storage documentation and changelog reviewed. Existing CMD design system takes precedence over generic skill styling/settings suggestions.

## Publication steps — require authorization

1. Review migration and access design; verify existing `private.is_org_member` accurately enforces active membership in staging. Run Supabase advisors, verify the new restrictive guards against the existing storage policy set, and exercise two actual staged users against the storage API. Do not weaken policies to make an upload pass.
2. Apply the migration in staging, provision only approved workspace/opportunity ACLs and the CMD `rfps` app switch/access. Verify save/reload, concurrent edits, upload/download, approval and historical submission flows with synthetic documents.
3. Review the branch/diff and screenshots. After explicit approval, merge/publish the code and apply the approved production migration/access grants in controlled order. The page fails closed if database or access setup is missing.
4. Separately approve sources, eligibility criteria, cadence, coverage/failure reporting and ingestion design before connecting daily discovery. Do not label it live until successful runs and provenance are visible.

## Local QA reproduction

Use the project's existing npm dependencies. Run `npx vitest run --config vitest.rfps.config.ts`, `npx tsc --noEmit`, and `npm run build`.

Start the isolated component preview with `npx vite --config vite.rfps-preview.config.ts`. Browser harness uses an installed Playwright module; set `PLAYWRIGHT_MODULE` to its module path and optionally `CHROMIUM_EXECUTABLE`, then run `node qa/rfps/browser-check.mjs`.

For SQL, create a disposable PostgreSQL database. Apply `qa/rfps/bootstrap.sql`, the migration, then `qa/rfps/policies.sql` with `psql -v ON_ERROR_STOP=1`. Never run the bootstrap or test fixture script on staging or production.
