# RFP source intake checkpoint — 2026-11-05

Worktree: `rfp-intake`; branch `feat/rfp-source-intake`; base and current production Git head verified `683e5f3f9af178080fc9b25a6088fde60c2c66be`.

## Completed locally

- URL-or-file entry, editable review, conservative labeled-field suggestions, unknown fields preserved, visible-source duplicate detection and database uniqueness.
- PDF/DOCX/TXT source extraction on the user's device, original private source preservation separate from proposal drafts, SHA-256 provenance, clear unsupported/scanned-document handling.
- Separate immutable source-file metadata table with existing opportunity-scoped authorization; no new account grants, sharing rows, buckets or storage-policy changes.
- URL reader authorizes the caller before fetching; bounded body, timeout, redirect validation, public-address checks and DNS pinning in the Node implementation.
- Mobile keyboard reachability, modal scrolling and Escape dismissal checked; selected-source button contrast corrected.

## Verification

- 78 tests across nine files passed: `/tmp/rfp-intake-final-tests.log`.
- TypeScript passed: `/tmp/rfp-intake-final-types.log`.
- Production bundle builds: `/tmp/rfp-intake-release-build.log`.
- Lint: zero errors; one existing workspace Fast Refresh warning: `/tmp/rfp-intake-release-lint.log`.
- Frozen Bun lockfile install passes without changes: `/tmp/rfp-intake-release-lock.log`.
- Local PostgreSQL migration + policy suite passed inside a rollback-only transaction. Owner/viewer/unshared/cross-organization/anonymous, immutable source, no source-as-approved-proposal, required source identity and duplicate protection tested. `/tmp/rfp-intake-policy-results.log`.
- Actual Chrome extraction of synthetic `qa/rfps/fixtures/source.pdf` and `source.docx` produced the expected title, issuer, round and date. No fixture was saved or uploaded to production.
- Actual public Pathway page read succeeded under Node (8,664 text characters). This does NOT prove Cloudflare runtime compatibility.
- 375px mobile intake and review inspected; Create remains keyboard-reachable in the scrollable dialog. No horizontal clipping observed.

## Release blocker — do not deploy this candidate yet

The build target is Cloudflare Workers (`.output/server/wrangler.json`), not a Node server. The current secure URL reader uses `node:dns/promises.lookup` and a custom pinned `node:https` lookup callback. Cloudflare documents `lookup` as not implemented and its HTTPS implementation as a wrapper around fetch, with no underlying socket access. A successful local Node test and bundle build therefore do not establish a usable or pinned production connection.

Official references:
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/

Do not replace this with an unrestricted fetch or weaken redirect/private-network checks just to make it run. Next step is a Workers-compatible, verified public-only retrieval design or an explicitly approved existing hardened retrieval service. A new service, credentials, persistent access or paid integration has NOT been created or authorized by this checkpoint. File/text review works locally, but shipping a reduced flow would need to be described honestly instead of claiming URL extraction is live.

## Production state (read-only checks)

- No intake migration applied; `public.rfp_source_files` absent.
- No Git commit/push, publish call, permissions change, credential generation or user data write in this resumed intake pass. Work remains uncommitted.
- 33 opportunities remain: captured 14, qualifying 15, preparing 2, submitted 2. Existing nine workspace access rows remain unchanged.
- Private `rfp-drafts` bucket unchanged (20 MB existing server limit; this source UI uses 10 MB).
- Current security advisor findings are pre-existing and unrelated to intake; no RFP-specific finding reported. No unrelated remediation attempted.
- Backup page displays latest physical backup `2026-11-04 10:05:51 UTC`; no newer backup displayed at check. Supabase also displays an investigating-technical-issue banner. Storage bytes are excluded from database backups. No restore/settings action taken.

## Status reconciliation already completed

TWC and Iditarod each have their verified sent event recorded with minute precision and unavailable file; receipt/outcome qualifications retained. Achievement First and Pathway are preparing. These records and dashboard counts were verified before intake work; current read-only counts still agree. See `../RFP-STATUS-RECONCILIATION.md` for IDs and evidence.

No uncertain production write exists: no intake production write was attempted. The blocker is runtime compatibility, not a denied approval or a laptop disconnection.

## Follow-up: supported Workers retrieval investigation and independent candidate

This section supersedes the earlier candidate's automatic-URL behavior. Production has still not changed.

A secure general URL reader is not established on the current supported Workers APIs. Local workerd probes confirmed: hostname-based TLS works but loses pinning; Node pinned-IP TLS fails; native `startTls(expectedServerHostname)` can read the public example and Pathway pages and reject a wrong hostname, but emits an explicit unsupported-option warning. Current official workerd source can reject this option behind an autogate. Normal fetch's resolveOverride cannot pin arbitrary external sources. Details and reproducible probes: `qa/rfps/url-runtime-investigation/README.md`.

Prepared independent local candidate:
- PDF/DOCX/TXT extraction + editable review and private source preservation remains enabled.
- URL alone becomes an explicitly un-fetched source reference, with blank title/issuer/round until entered by the user. It does not invent facts from a domain name.
- Pasted source text can suggest fields; provenance explicitly says the page was not fetched.
- UI says automatic URL reading is not connected. The authenticated source endpoint fails closed with HTTP 501 and does not import or invoke the Node prototype. The built server bundle contains neither the prototype's lookup timeout nor its request User-Agent marker.
- No normal-fetch fallback, credentials, service, plan change, permission change or document transmission was introduced.

Validation: 80 tests pass, TypeScript passes, build passes, lint has zero errors (same existing Fast Refresh warning). Logs: `/tmp/rfp-independent-tests.log`, `/tmp/rfp-independent-types.log`, `/tmp/rfp-independent-build.log`, `/tmp/rfp-independent-lint.log`. New tests cover URL-only unknowns, no URL request, file-first creation with hash and no invented URL, and no duplicate creation after a failed separate file step. Browser checked the updated URL warning/blank fields and synthetic PDF extraction. Earlier browser DOCX test and rollback-only source-table policy tests remain applicable; their parser/schema code is unchanged.

Remaining publication needs / gaps:
1. The file-first candidate can be delivered independently, but it does not meet automatic URL extraction. That scope must be described honestly.
2. Its prepared source-table migration must precede the UI release. No migration has been applied here; no grants, RLS or storage settings changed during this pass.
3. Full live upload/download behavior is not verified; no real documents or synthetic production records were created. Local SQL authorization and component save/failure tests passed.
4. Scans need manual input; no OCR. Native private Google Docs require downloading PDF/DOCX through existing access. No permission changes are needed for that path.
5. Extraction is conservative, not semantic AI: unlabeled issuer/round and non-ISO deadlines stay unknown for review. PDF pages capped at 100; files capped at 10 MB.
6. Opportunity creation and file preservation are separate steps. On failure after creation, UI prevents repeating creation and reports reconciliation required; it does not offer automatic retry or silently treat a source as a proposal draft.

No deployment, commit, push or production write was attempted in this investigation. All changes remain in the isolated uncommitted worktree.
