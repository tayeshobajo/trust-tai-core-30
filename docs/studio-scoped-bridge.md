# Studio scoped research bridge — 2026-11-06

## Delivery state
Local implementation on `codex/studio-scoped-bridge` in `../studio-bridge`, based on deployed UI commit a25f039f plus cherry-picked research contracts (3547fc2c). Original dirty checkout and release checkout preserved. No source push, deployment, hosted migration, agent resume or schedule change.

## Implemented
- Authenticated TanStack server functions for scoped identity check, recent request history, manual start and result read. Session is reverified; active membership and current Studio view/work rules apply. Errors returned to UI are sanitized.
- Exact organization environment binding plus verified `trust-tai` slug. Company/project/agent fixed to verified handoff; never accepted from browser.
- Dedicated `PAPERCLIP_STUDIO_BRIDGE_KEY`, only server-side. Does not use PAPERCLIP_BOARD_KEY. Self-identity uses `/api/agents/me`, validates task_bridge scope and preserves paused status. Fixed HTTPS recipient, redirects forbidden, bounded responses, no POST retries.
- Durable service-only request store, atomic unique claim, immutable topic/identity, org-scoped issue attachment CAS, uncertain-dispatch tombstone, immutable accepted result. Migration is staged, not applied to hosted Supabase.
- Sources panel: explicit connection check and manual start, request ID retained through errors, manual result checks and recent history. Sourced result cards and limitations are review-only; no source ingestion, automatic learning or publishing.
- Fail-closed activation: `PAPERCLIP_STUDIO_RESEARCH_ENABLED` must equal `true`, exact workspace bound, storage ready, and agent status admitted. Defaults do not dispatch.

## Evidence
- 48 Vitest tests pass (coordinator, auth, runtime gate, durable-store adapter); 8 Node transport tests pass.
- Isolated PostgreSQL 17 migration test passed: one winner from concurrent inserts, anon/authenticated table denial, immutable identity, no reset after dispatch, CAS loser cannot attach, accepted result immutable and requires requestId. Fixture database used a private local Unix socket, no production connection; server stopped afterward.
- TypeScript and affected production-file ESLint pass. Production build passed; final repeat after exact-org gate recorded in ../studio-bridge-build-final.log.
- Browser bundle scan found zero server-secret environment-name markers (Paperclip key / Supabase service keys).
- Local browser preview: http://127.0.0.1:5183/ (paused); ?scenario=ready, ?scenario=error, ?scenario=uncertain. Actual ResearchPanel with injected fictional responses, no backend/credential calls. Verified paused/failed connection disables start, submitted request disables repeat start, sourced review, request retention and uncertain warning. Mobile 375px had no horizontal overflow; viewport reset.
- Local preview is a component fixture, not hosted end-to-end evidence, and not a full accessibility or device audit.

## Saved credential verification
Lovable read-only diagnostic `umsg_01m6qgcrj2ed4am3g3c61cr67d`, thread main, reports one GET to `/api/agents/me` using its stored environment secret, redirects forbidden, timeout 15s: HTTP 200; exact agent/company/task_bridge/project/allowed-assignee match; no additional parent/project scopes; status paused. Final diagnostic content is the evidence; its generated summary contained a contradictory redirect sentence and is not relied upon. No secret value or response body was returned. This verifies the Lovable sandbox, NOT the deployed application runtime.

## Remaining activation requirements / approval boundaries
1. Review and authorize publishing this additional server/security-sensitive source to public GitHub's connected preview branch. Prior public-source approval covered the UI polish; this pass explicitly disallows unapproved publication. No push attempted.
2. Review/apply `supabase/migrations/20261106010000_studio_research_requests.sql` to the intended backend (`okydosoacqdnursmmenf`) or isolated staging backend. Existing preview and production use the same external backend; no silent production migration. No browser grants are introduced.
3. Set server-only `PAPERCLIP_STUDIO_ORGANIZATION_ID` to the verified Trust Tai organization UUID. Do not substitute Paperclip's company ID. Existing server service credential must be verified for this backend without exposing its value; no new privileged credential is created by this implementation.
4. Verify actual hosted route identity/auth/storage before enabling dispatch. Keep `PAPERCLIP_STUDIO_RESEARCH_ENABLED` absent/false until this and worker admission are reviewed.
5. Agent is paused. Resuming/manual wake admission, search/read tools, budget/concurrency and no automatic timers/routines need explicit coordinated approval/verification. Do not broaden key to generic agent APIs. No real research task has run.
6. A bounded end-to-end run needs an explicitly selected public topic, then one issue, durable binding, sourced agent comment and UI review. Browser auth, real Paperclip create/comment shapes, network-failure persistence and production write path have not been exercised end to end.
7. Final production publish remains separate. Image generation/persistence, LinkedIn sync/discovery and automatic learning are unchanged and unconnected.

## Test commands
`node --test qa/studio-research/transport.test.mjs`
`node_modules/.bin/vitest run --config qa/studio-research/vitest.config.ts`
`node_modules/.bin/tsc --noEmit`
`npm run build`
Database script requires a fresh disposable database at fixed local socket /tmp/studio-research-pg-socket port 55439, precreated anon/authenticated/service_role (bypassrls) fixture roles, and optional STUDIO_QA_DATABASE name. Never repoint it at production.

## Database safeguard review fixes — 2026-11-06

The staged migration now revokes ALL table privileges from service_role as well as browser roles before granting only SELECT/INSERT/UPDATE. This removes inherited DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN rights under the actual production defaults. The result correlation predicate now requires IS TRUE, rejecting SQL NULL caused by a JSON-null requestId.

Regression evidence: isolated PostgreSQL 17 with production-equivalent table/function default grants and service_role BYPASSRLS. All 24 role/privilege combinations asserted; actual service-role DELETE/TRUNCATE attempts denied and dispatch row retained. Missing, JSON-null, wrong and non-string requestId plus JSON-null result rejected by CHECK constraints; valid correlated result accepted. Existing concurrency, CAS and immutability tests pass. Two negative controls confirmed the tests fail against the old grants and against old nullable correlation SQL with grants fixed. Temporary database server stopped afterward. No hosted migration or settings change.

48 Vitest + 8 Node transport tests pass. Only SQL, database regression script and this record changed; app build was not repeated for these non-runtime-source changes. Earlier TypeScript/lint/production build results remain applicable. STUDIO_QA_MIGRATION optionally selects a local fixture SQL file for negative-control testing; socket remains fixed and must never point to production.

## Initial hosted preview sync boundary
This preview commit deliberately excludes supabase/migrations/20261106010000_studio_research_requests.sql. The reviewed SQL remains only in local codex/studio-scoped-bridge at a33983f1. Database fixture tests require that separately retained SQL; they are not runnable from this preview checkout alone. No migration application is authorized by this sync. Keep PAPERCLIP_STUDIO_RESEARCH_ENABLED absent/false and Studio Research paused. PAPERCLIP_STUDIO_ORGANIZATION_ID remains unset pending separate configuration approval; the preview must report unavailable until exact binding is configured.
