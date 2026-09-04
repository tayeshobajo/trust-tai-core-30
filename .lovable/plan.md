# Trust Tai OS metabolism: commercial layer, scoreboard, Sentinel, momentum floors, voice notes

## Answers to the three questions (from the repo, not assumption)

**1. Where should `weekly_targets` live? A dedicated org-scoped table.**
`docs/settings-schema.sql` has no generic settings bag. It is five purpose-built tables
(`organization_app_settings`, `member_app_access`, `organization_invitations`,
`user_notification_preferences`, `organization_role_app_access`), each with typed columns,
its own unique key, `private.is_org_member` reads / `private.is_org_admin` writes, and
`anon` fully revoked. The two jsonb columns that exist (`app_access`, `preferences`) are
scoped to their own concern. Weekly targets are numeric, versioned, org-level and audited
(who changed the target, when), which is a different shape from every existing row. A new
`organization_weekly_targets` table following the exact same RLS/grant pattern is
materially cleaner than a jsonb blob nobody can constrain or audit.

**2. Sentinel cadence: nightly batch, not 6-hourly.**
Every scheduled job in this repo is pg_cron + `net.http_post` into an app endpoint or edge
function, secured by a shared secret; nothing schedules itself inside the Node server.
Existing cadences: Comms Gmail sync `17 */6 * * *` (bounded, 2-day overlap window),
Paperclip reconcile every 5 minutes. Scout is different in kind: it is on-demand only, one
model call per run, `DEFAULT_LIMIT = 25`, `MAX_LIMIT = 50`, `RUN_COOLDOWN_SECONDS = 45`.
Sentinel over 300 domains is per-domain website research, not one batched call, so it is
roughly an order of magnitude more work than any job here. The repo states no hosted
timeout or concurrency ceiling, so I will not design against a guessed one; instead the
design is self-bounding: **nightly cron, one slice per run, hard cap of 40 domains per
run, staleness-ordered (oldest `last_swept_at` first)**, so a 300-domain list fully
refreshes on a rolling ~8-day cycle and any single run stays comparable in size to an
existing Scout run. Cadence and slice size are stored config, so raising them later is a
value change, not a rewrite. A 6-hourly sweep is rejected on evidence, not preference.

**3. Ops: a new observation type is required.**
Ops today produces **no uptime, TLS, or CMS-plugin observations at all**. It writes generic
`activities` rows with `app_key = 'ops'` and event names `ops.blocked`,
`ops.issue_detected`, `ops.qa_failed`, `ops.approval_required`, `ops.completed`,
`ops.qa_passed`; Core derives `technical_risk` signals from those. The `website_*` schemas
are visitor attention and intake, not infrastructure. The documented boundary is one-
directional: Ops writes activities, Core reads. There is no fact shape Scout can attach
today, and no rule permitting Scout to read `app_key='ops'` rows for its own purposes.
So work item 3's Ops health observations need a new vocabulary at the Ops boundary, and
Ops itself (a separate deployed app) must emit it. That is a cross-app dependency, listed
as a blocker below.

## (A) Current-state findings

- No `weekly_target*`, no watchlist/domain-list table, no commercial/tier/proposal table
  anywhere in `src` or `docs`. `clients` is read in two places only
  (`roadmap-service.ts`, `roadmap-subjects.ts`); `Client` in `src/domain/entities.ts` is
  `{ name, status: LifecycleStatus, stewardUserId? }`.
- Pulse projection is pure and deterministic (`src/data/pulse/projection.ts`): severity
  from written rules, static per-room `ACTION_LABEL` and `AREA_OF` tables, feedback
  suppression via `NOT_NOW_DAYS` / `NOT_USEFUL_THRESHOLD`. There is no floor concept yet.
- `ThreadChannel` = `email | call | meeting | message | note | linkedin | text`;
  `Touch` already carries `channel`, `direction`, `occurredAt`, `summary`, `loggedBy`,
  `provenance`. A voice note fits this model as a new channel plus a logged touch.
- Scout persists `source` on `prospects` (`scout_preview_demo`, `scout_live_website`,
  `website_intake`) and refreshes an existing prospect in place per normalized website.
- roadmap.md open items are all deploy/verify, not build: people-activity schema,
  approvals-v1 schema, invite email E2E, content-images bucket, publish endpoint.

## (B) Scoped implementation plan

Six phases, in the brief's order, gated on phase 0.

**Phase 0 — close the open ledger.** Nothing new ships until roadmap.md's open items are
production-verified: deploy `people-activity-schema.sql` and `approvals-v1-schema.sql`,
confirm one real invite email end to end, Gmail send re-consent plus one real sent reply,
Add-to-Comms backfill live, public `content-images` bucket plus publish endpoint plus one
controlled article with a verified canonical URL. Each is evidence, not a checkbox.

**Phase 1 — commercial layer.** Extend the core `Client` with a commercial record: tier
(`run` / `diagnose` / `build`), engagement state, weekly value, started/ended. A proposal
stage attaches to the existing prospect/roadmap lineage by id (never a copied record).
Roadmap owns proposal state; Comms owns the sending relationship; neither duplicates the
other. Every change writes provenance (who, when, observed vs decided) and emits through
`emitSuiteEvent` with new vocabulary (`client.tier_changed`, `proposal.sent`,
`proposal.signed`).

**Phase 2 — Week scoreboard.** Targets are org-level stored config; **actuals are derived
only**, never stored. Home renders a Week band beneath Today: first touches, discovery
calls, proposals sent, signed, active Run clients, revenue by tier. Any line with no
truthful derivation is absent, not zero. Pulse's right rail shows one On pace / Behind
read that links to Home; it derives nothing of its own.

**Phase 3 — Sentinel.** `scout_watchlist`, curated, up to 300 domains, txt/csv upload
staged before an explicit save (mirroring the existing ICP upload behaviour). Nightly
bounded sweep re-runs `scout-research` per slice, refreshing prospects in place with
`source = scout_sentinel`. A Movement filter shows only companies whose **observed**
evidence changed, with what changed and when; `prospect.movement_observed` is emitted only
on a real observed delta. Coverage is reported as counts (swept, pending, failed), never
as a claim of completeness.

**Phase 4 — momentum floors.** Deterministic rules in the Pulse projection: when a derived
weekly actual sits at zero (or below a stated floor) with days remaining, the relevant
signal's severity is raised to a floor level. Labels still come from the owning room's
`ACTION_LABEL`. Floors respect the existing feedback contract and can never override a
human gate, manufacture urgency, or invent a signal that has no evidence behind it.

**Phase 5 — voice notes.** New `voice_note` channel on `ThreadChannel`. A human records or
logs it; Comms stores a one-line summary and an optional link. No transcription, no
generation, no audio analysis. It may be *recommended* only when the Scout move is
`act_now` or `no_urgency` **and** there is a traceable person, and the recommendation
carries an evidence-grounded talking-point brief explicitly labelled not a script. It
counts as a first touch in the scoreboard. Text protections are untouched.

## (C) File-level impact

Create: `docs/commercial-v1-schema.sql`, `docs/scout-sentinel-schema.sql`,
`src/domain/commercial.ts`, `src/domain/scoreboard.ts`, `src/domain/sentinel.ts`,
`src/data/supabase/commercial-service.ts`, `src/data/supabase/weekly-targets.ts`,
`src/data/supabase/scout-watchlist.ts`, `src/data/scoreboard/derive.ts`,
`src/components/tt/home/week-scoreboard.tsx`,
`src/components/tt/scout/watchlist.tsx`, `src/components/tt/scout/movement.tsx`,
`src/routes/api/public/scout.sentinel-sweep.ts`, `docs/commercial-v1.md`.

Modify: `src/domain/entities.ts` (commercial record on Client), `src/domain/events.ts`
(new vocabulary), `src/domain/comms.ts` + `CHANNEL_LABEL` (`voice_note`),
`src/domain/pulse.ts` and `src/data/pulse/projection.ts` (floors),
`src/routes/index.tsx` (Week band), `src/routes/modules.pulse.tsx` (pace line),
Scout board and settings routes (watchlist, Movement filter),
`src/data/supabase/scout-service.ts` (sentinel refresh path), `roadmap.md`.

## (D) Schema deltas

`docs/commercial-v1-schema.sql`: `client_commercial` (one row per client: tier check
constraint, engagement state, weekly value numeric, started_at/ended_at, updated_by,
timestamps, unique on `client_id`), `client_commercial_history` (append-only provenance of
every change), `proposals` (references prospect and/or roadmap by id, stage, sent_at,
signed_at, value, provenance jsonb, unique on source lineage for idempotency).

`docs/commercial-v1-schema.sql` also carries `organization_weekly_targets` (one row per
org: the six target numbers, effective_from, updated_by) — actuals are never stored.

`docs/scout-sentinel-schema.sql`: `scout_watchlist` (org, normalized domain, label, added_by,
active, last_swept_at, last_movement_at, sweep_state, unique on `(organization_id, domain)`,
a check enforcing the 300-domain ceiling at the service layer), plus `scout_sentinel_runs`
(run id, started/finished, slice size, swept/failed counts) for honest coverage reporting.

All tables: `revoke all from anon; revoke all from authenticated; grant select/insert/
update/delete to authenticated; grant all to service_role;` RLS enabled, select via
`private.is_org_member`, writes via `private.is_org_admin` where the change affects the
whole org (targets, watchlist) and `is_org_member` where it is ordinary work. No
RLS-bypass RPCs. Events emitted only by the owning room through `emitSuiteEvent`, with a
`sourceEventKey` so a repeated sweep is a no-op.

## (E) Delivery sequence with gates

0. Phase 0 verified in production → **gate: no new feature merges until every open
   roadmap item shows real evidence.**
1. Commercial schema applied → services + tests → UI. Gate: provenance row written for
   every change, events visible in the shared stream.
2. Scoreboard derivation + tests → Home band → Pulse pace line. Gate: every displayed
   number traceable to derived data; unavailable lines absent.
3. Sentinel schema → watchlist UI + staged upload → sweep endpoint behind its cron secret
   → enable nightly cron last. Gate: one manual bounded run over a small real list before
   the cron is scheduled.
4. Momentum floors behind fixtures → enable. Gate: floor never changes a gate outcome.
5. Voice note channel → logging → recommendation. Gate: no transcription path exists.

## (F) Tests and acceptance mapping

- Scoreboard derivation unit tests: on pace, behind, and absent-line cases → "Home
  truthfully answers are we on pace".
- Sentinel fixtures: curated domains with and without observed deltas → quiet board plus a
  small Movement set carrying what changed and when; idempotent re-sweep writes no event.
- Pulse floor fixtures: a zero-first-touch week raises Act now; a week at target stays
  silent → the floor acceptance criterion.
- Comms voice-note test: logged touch appears in relationship history and in the weekly
  first-touch count; text-route protections unchanged.
- Existing Scout/Comms law tests are not edited. Full suite plus typecheck must pass.

## (G) Blockers and questions before implementation

1. **Ops observations are not buildable from this repo alone.** Ops emits no uptime/TLS/
   CMS-plugin facts. Either the Ops app must first emit a new observation vocabulary, or
   work item 3's Ops health attachment is deferred and Sentinel ships without it. Which?
2. **Revenue derivation.** Weekly revenue per tier: derive from `client_commercial.weekly
   value` summed over active clients, or from something else? Nothing in the repo records
   money today.
3. **"Discovery calls held" and "proposals sent"** have no current source of truth. Are
   these logged by a human in Comms/Roadmap (which I would build), or expected to be
   inferred? Inferring them would manufacture data.
4. **Voice note storage.** Is the optional link an external URL only, or does an audio file
   get stored (which would need a bucket and a retention decision)?
5. Confirm the nightly cadence and 40-domain slice, or state the numbers you want.
