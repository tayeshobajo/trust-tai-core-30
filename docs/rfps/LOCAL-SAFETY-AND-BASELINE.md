# Local staging guard and baseline plan

Prepared locally before Tai chose direct production publication; retained as an optional safety harness. No staging instance is required or created by these files.

## Guard

`vite.rfps-staging.config.ts` builds only `qa/rfps-staging/main.tsx`. It aliases the RFP service's Supabase import to `qa/rfps-staging/client.ts`, so normal CMD backend fallbacks and server routes are not in this artifact.

Three explicit variables are mandatory: `VITE_RFP_STAGING_PROJECT_REF`, `VITE_RFP_STAGING_URL`, `VITE_RFP_STAGING_PUBLISHABLE_KEY`. Configuration rejects the production ref/key, mismatched/credentialed/path-bearing URLs, non-HTTPS hosted origins, secret keys and legacy JWT keys. Local mode accepts only explicit loopback addresses. The transport rejects every other origin before invoking fetch and rejects redirects; CSP independently restricts browser connections to that origin. Auth persistence, URL-session detection and token auto-refresh are disabled; existing production browser sessions are not reused.

This is a deliberately separate RFP test artifact, not a claim that every legacy CMD server route is staging-safe. The normal CMD client/server configuration remains unchanged. The synthetic build key used in verification is not a credential and no request was sent to that fictional project.

Tests: no-config build fails before bundling; production-config build fails before bundling; explicitly synthetic non-production build succeeds; transport mock proves production requests never reach fetch. 43 focused tests pass including 13 new boundary cases. No runtime or user was provisioned.

## Schema-only baseline inspection

Read-only production catalog queries on 2026-11-04 found 129 public tables, one private table, 36 non-internal public/private triggers and extensions plpgsql, pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault, pg_cron, pg_net. Existing active-membership helper and foundational foreign keys were inspected; no business rows, user tokens, secret values or stored file bytes were extracted.

Remote migration history has 32 entries. The matching earliest repository migration references organizations and conductor_actions that it does not create; repository migrations do not create the foundational membership tables/helper. A migration replay alone is not a complete schema baseline. A fresh branch cannot be declared usable merely because its creation API succeeds.

If a full isolated clone is ever approved, use a reviewed schema-only export from authorized read-only sources: public/private tables, sequences, enum/domain types, indexes, constraints, views, functions, policies, grants, default privileges, triggers and extension dependencies. Include only application-owned additions to managed auth/storage schemas; let Supabase supply its version-matched managed schemas. Separately inventory API exposure and storage policy/bucket *configuration*, without copying objects or production data. Do not copy Vault contents, integration secrets, OAuth/SMTP secrets, auth users, cron job rows or webhook destinations. Inspect definitions/defaults for embedded endpoints or secrets before saving or replaying them. Disable copied outbound automation in the isolated environment before synthetic seeding, with explicit approval for those test-environment changes.

Validate an empty restore and catalog parity before calling that export complete. The current local SQL bootstrap is a minimal dependency test double, not a complete CMD baseline. No complete export/restore has been performed in this task.

Current direction is direct production: see PRODUCTION-PREFLIGHT.md. No hosted staging approval is sought. If that direction changes, smallest approval would cover one temporary data-less Micro branch, its new branch credentials and disposable test identities/grants, a short lifetime and cleanup; published base compute starts at $0.01344/hour plus usage and is not protected by Spend Cap. First prove a complete schema baseline. No automatic merge or production deployment would be included.
