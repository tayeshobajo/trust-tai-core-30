# Comms external-integration layer

Goal: make Comms proactive for networking and relationship stewardship (Tennessee/Nashville first) by connecting five external tracks — Gmail, LinkedIn-compatible people intelligence, event feeds, people-data providers, email discovery/verification — without breaking any existing Comms principle. No sending, no scraping, no invented truth, no demo data in production.

## A. Current-state inventory (reuse, do not duplicate)

Live Supabase tables (external project, RLS via `private.is_org_member`):
- Shared core: `contacts`, `clients`, `prospects`, `organizations`, `organization_memberships`, `activities`, `icp_profiles`.
- Comms: `comms_relationships`, `comms_threads`, `comms_touches`, `comms_drafts`, `comms_reminders`, `comms_voice_profiles`.

Code we build on:
- `src/domain/comms.ts` — stages, `MemoryItem` tiers (observed/inferred/decided), `ThreadState`, `DueState`, `ReasonCode`, `dueState()`.
- `src/data/comms-queue.ts` — buckets, sort, coverage. `src/data/comms-reminders.ts` — evidence-bound reasons.
- `src/data/supabase/comms-service.ts` + `comms-schema.ts` — all reads/writes and row mapping.
- `src/data/supabase/comms-handoff-receiver.ts` — idempotent Scout → Comms.
- `src/lib/comms-draft.server.ts` + `src/data/voice-policy.ts` + `src/domain/voice.ts` — Voice DNA drafting and deterministic checks.
- People layer already provider-shaped: `src/domain/people.ts` (`PeopleProvider`, `EmailStatus`, `PersonConfidence`), `src/data/people/registry.ts`, `website-people.ts`, `enrichment.ts`, `src/data/supabase/contacts.ts` (people fields live in `contacts.metadata.people`), `people-service.ts`.
- UI: `src/components/tt/comms/{relationship-queue,relationship-workspace,next-move-rail,capture-form,comms-tabs}.tsx`, routes `src/routes/modules.comms*.tsx`, server route pattern `src/routes/api/public/comms.draft.ts` (bearer-authenticated, RLS as the user).

Reuse decisions: people/enrichment/verification providers extend the existing `PeopleProvider` registry rather than a new abstraction; email state stays `EmailStatus`; threads/touches stay the Comms history model; no second CRM.

## B. Target architecture

```text
 external sources            server adapters (keys server-side)        Trust Tai truth
 -------------------         ----------------------------------        ------------------
 Gmail API            -->    /api/public/comms/gmail/*  (sync)     -->  comms_threads
                                                                       comms_messages (new)
                                                                       comms_touches (inbound/outbound)
 people providers     -->    people registry + server adapters     -->  contacts.metadata.people
 email discovery      -->    discovery adapter                     -->  EmailStatus: found
 email verification   -->    verification adapter                  -->  EmailStatus: verified/risky/...
 event providers      -->    /api/public/comms/events/sync         -->  comms_events (new)
                                                                       comms_event_targets (new)
 public web research  -->    existing model+web-search server path -->  observed MemoryItem + evidence
```

Flow rules:
- Every external claim enters as **observed** with provenance and `fetched_at`, or **inferred** if derived. Only a person writes **decided**.
- Stage, send, and approval remain human. Sync may move `thread.state`, `last_touch_at`, `response_due_at` — never `stage`.
- Providers may fail; Comms shows "not connected" or "not available", never fabricated data.

## C. Schema additions (minimal, additive only)

New tables (org-scoped, same GRANT → RLS → policy shape as `docs/comms-v1-schema.sql`, `private.is_org_member`). Documented in a new `docs/comms-integrations-schema.sql`.

1. `comms_messages` — the only real gap. Per-message record so threads have state and idempotency.
   `id, organization_id, relationship_id, thread_id, provider ('gmail'), provider_message_id, provider_thread_id, direction, from_email, to_emails jsonb, cc_emails jsonb, subject, snippet, body_text, occurred_at, headers jsonb, provenance jsonb, created_at`
   `unique (organization_id, provider, provider_message_id)`.
2. `comms_integrations` — one row per org+provider connection: `id, organization_id, provider, status, account_email, scopes jsonb, cursor jsonb (historyId/pageToken/sinceAt), last_sync_at, last_error, connected_by, created_at, updated_at`, `unique (organization_id, provider, account_email)`. Tokens are NOT stored here in plaintext; see F.
3. `comms_events` — `id, organization_id, source ('manual'|'ics'|'api'|'public_page'), provider_event_id, name, starts_at, ends_at, city, region, venue, url, topics jsonb, description, observed jsonb, provenance jsonb, created_by, created_at, updated_at`, `unique (organization_id, source, provider_event_id)`.
4. `comms_event_targets` — why an event matters and who to meet: `id, organization_id, event_id, relationship_id nullable, contact_id nullable, rationale text, reason_code text, evidence jsonb, score int, state ('suggested'|'accepted'|'dismissed'), decided_by, created_at`.

Changed tables:
- `comms_threads`: add `provider text`, `provider_thread_id text`, `owner_user_id uuid`, `response_due_at timestamptz`; `unique (organization_id, provider, provider_thread_id)` where provider_thread_id is not null.
- `comms_relationships`: no new columns. LinkedIn URL, event history, provider provenance go into `metadata` and the tiered memory arrays (matching how Scout uses `contacts.metadata.people`).
- `contacts`: no columns added. Extend `metadata.people` with `linkedin_url`, `email_checked_at`, `email_checked_by`, `suppressed_at`, `suppression_reason`, `provider_ids`.

## D. Endpoints and provider interfaces

Server routes (bearer-authenticated, act as the signed-in user; `/api/public/*` bypasses site auth so each handler authenticates itself, following `comms.draft.ts`):
- `GET/POST /api/public/comms/gmail/connect` — OAuth start/callback, stores connection status.
- `POST /api/public/comms/gmail/sync` — incremental sync for one org connection; returns counts, never raw tokens.
- `POST /api/public/comms/events/sync` — run registered event providers.
- `POST /api/public/comms/people/discover` and `/api/public/comms/email/verify` — thin wrappers over the provider registry when a provider needs a server key.
- Existing `/api/public/comms/draft` extended to accept `threadId` for reply drafting.

Interfaces (new files under `src/domain` / `src/data`):
- `MailProvider`: `available()`, `listChanges(cursor)`, `getThread(id)`, `normalize(message) -> NormalizedMessage`. Gmail is the first implementation; nothing else in Comms knows about Gmail.
- `EventProvider`: `id, label, kind ('api'|'ics'|'public_page'|'manual'), approved, available(), fetch({ region, since, until }) -> EventDraft[]`, registered in `src/data/events/registry.ts` mirroring `src/data/people/registry.ts`.
- People/email: extend the existing `PeopleProvider` with optional `discoverEmail` / `verifyEmail` (already declared) and add a `SuppressionStore` check before any address is treated as reachable.
- Pure logic modules (unit-testable with no vendor): `src/data/comms-thread-state.ts` (message stream → thread state, response-due, owner), `src/data/comms-event-fit.ts` (event → ranked targets + rationale), `src/data/comms-network-recs.ts` (relationship graph → connection targets, warm intros).

## E. Sync and idempotency

- Gmail: full backfill bounded to a configured window on first connect, then incremental via `historyId` stored in `comms_integrations.cursor`. Every message upserted on `(organization_id, provider, provider_message_id)`; threads upserted on `(organization_id, provider, provider_thread_id)`. Re-running a sync produces zero new rows.
- Participant mapping order: existing relationship by `provider_thread_id` → contact by exact email → relationship by email → create contact + relationship with `source='inbound'`. Never fuzzy-match names automatically; ambiguous matches produce an "unmatched" state for a human, not a guess.
- Derived signals only: inbound with no later outbound → `waiting_on_us` + `response_due_at`; outbound last → `waiting_on_them`. `last_touch_at` moves only for real messages, preserving the existing "no claimed contact" rule.
- Events and people providers: upsert on natural keys, store `fetched_at`, and never overwrite `human_confirmed` values (existing `isHumanOwned` rule).
- All syncs record an `activities` row so the shared stream stays the single history.

## F. Privacy, security, RLS, secrets

- All provider keys and OAuth secrets are server-side env only (Project Settings → Secrets). Nothing reaches the client bundle; the browser calls our routes only.
- Gmail refresh tokens: stored server-side, encrypted at rest, never selectable by `authenticated`. `comms_integrations` exposes status/cursor to members; the token column lives in a private-schema table readable only by `service_role`.
- Gmail scopes: read-only (`gmail.readonly`) in v1. No send scope requested, which makes auto-send impossible by construction.
- Body storage: store snippet + text body only when the org opts in; default is snippet + metadata. Add a per-org retention/purge switch.
- Every new table: GRANT → ENABLE RLS → member policies via `private.is_org_member`. No `anon` grants anywhere.
- Suppression/opt-out list is checked before any address is shown as reachable and before any draft is created for that person.
- Fail closed: a missing connection or missing key renders "Not connected" with no data, never sample rows.

## G. UX changes

- **Relationship Queue**: unchanged bucket philosophy, plus real inbound-driven "Needs you" from Gmail thread state, and a small provider chip when a bucket entry came from sync. New optional buckets only if evidence supports them.
- **Relationship workspace**: a Threads/Messages section with real Gmail history, thread state and owner; LinkedIn URL and profile facts shown as observed with source; email status chip using existing `EmailStatus` labels ("Found, unverified" never reads as verified).
- **Next move rail**: reply drafting for a selected thread, quoting only stored evidence; Voice DNA checks unchanged; approve + mark sent stays human.
- **Conference capture**: extend `capture-form.tsx` with an event picker (from `comms_events`) and a bulk "met these people at X" flow; matches shared contacts first, as today.
- **Events room** (new tab under Comms): upcoming Tennessee/Nashville and travel-relevant events, each with "why this matters", who to meet (linked relationships/contacts), and the evidence behind it. Accept/dismiss writes to `comms_event_targets`.
- **Networking recommendations**: a restrained list (cap per week) of connection targets and warm-intro paths, each with a stated reason and evidence; dismissals are remembered and suppress repeats.
- Warm Terracotta ambient wash applies to all new Comms surfaces via existing `AmbientSurface`/`AmbientRule`.

## H. Phased build order

1. **Phase 0 — foundations (no vendors).** `comms_messages`, `comms_integrations`, thread columns; `MailProvider`/`EventProvider` interfaces; `comms-thread-state.ts` pure logic + tests; UI shows "Not connected" states.
2. **Phase 1 — Gmail read-only.** OAuth connect, incremental sync, participant mapping, thread state, inbound-driven queue, reply drafting through Voice DNA. Depends on Phase 0 + Google credentials.
3. **Phase 2 — email discovery/verification.** Discovery and verification adapters behind the people registry, suppression list, strict status semantics across Scout and Comms. Depends on vendor keys; logic testable with a fake adapter.
4. **Phase 3 — people intelligence / LinkedIn-compatible.** Manual LinkedIn URL entry, compliant public web research into observed memory, approved-provider adapter, decision-maker discovery reusing Scout's people layer.
5. **Phase 4 — events.** `comms_events` + targets, manual and ICS import first (no vendor needed), then API providers; event fit ranking and the Events tab.
6. **Phase 5 — networking recommendations.** Combine relationship graph + events + role relevance into capped, evidence-bound suggestions.

Testable before any credentials: all pure logic modules, normalization from fixture payloads, idempotency (double-apply a fixture batch), RLS policy checks, manual/ICS event import, manual LinkedIn URL capture, "not connected" UI states.

## I. Acceptance tests per phase

- P0: applying the same normalized batch twice creates zero duplicate rows; thread state transitions match the table in E; non-member reads return nothing.
- P1: connect → sync → a real thread appears on the right relationship; second sync adds nothing; an inbound message puts the relationship in "Needs you" with a response-due; a reply draft cites only stored evidence and passes Voice checks; no send scope is present in the granted token.
- P2: a discovered address shows "Found, unverified" everywhere; only a verifier can set `verified`; a suppressed address blocks drafting; bounce marks `bounced` and removes reachability.
- P3: no LinkedIn HTML is ever fetched; profile facts appear only with a source; provider claims never overwrite human-confirmed values.
- P4: an imported event renders with why-it-matters and at least one named target with evidence, or it renders with an honest "no clear reason yet"; dismiss persists.
- P5: recommendations are capped, each has a reason code and evidence, and dismissed suggestions do not return.

## J. Credentials needed from Tai (none assumed connected)

- Google Cloud project + OAuth client (ID/secret, `gmail.readonly` scope, redirect URI) and the Gmail account(s) to connect.
- An approved people/company enrichment provider account and key (choice pending).
- An email verification provider key (choice pending); optionally a separate discovery provider.
- Event source(s): API key(s) if any, plus any ICS calendar URLs or event pages to import.
- Confirmation of body-storage and retention preference for Gmail content.

## K. Risks and anti-patterns

- **LinkedIn scraping** — forbidden. No fetching of LinkedIn pages, no automation of the site. URLs and manually provided data only, plus approved providers.
- **Duplicate contacts** — sync must match through shared `contacts` by email first and never auto-create on name similarity; ambiguity goes to a human queue.
- **False verification** — discovery and verification are separate adapters; a guessed pattern address can never reach `verified`.
- **Over-automation** — read-only Gmail scope, no auto-send, no auto-stage changes, no sequences.
- **Noisy recommendations** — weekly caps, evidence required, dismissals remembered; an empty list is a correct answer.
- **Scope creep** — nothing here touches Roadmap or Projects.
