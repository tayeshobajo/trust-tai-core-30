# Trust Tai OS, execution ledger

The canonical plan is `docs/production-plan.md`. The canon in
`docs/architecture-canon.md` outranks both. This file is the live status only.

Status vocabulary: Not started, Implemented, Code/Test Verified, Runtime Verified,
Production Verified, Human Accepted. Lovable saying done is at most Implemented.

## Progress

**Production Readiness: 19%** (P0 to P7)
**Full Engine: 16%** (P0 to P9)

Working (corrected in slice P0-001A, extended in P1-002, P0-07 verified 2026-09-05,
P0-08 and P0-03 Human Accepted 2026-09-06):

- P0 weight 12 (readiness) / 10 (engine), 9 gates, **8 met** -> 12 x 8/9 = 10.7 and
  10 x 8/9 = 8.9
- P1 weight 12 / 10, 6 gates, **4 met** (P1-01 Production Verified 2026-09-06 on
  the real Mental Dental row; P1-02 Production Verified 2026-09-06 on the real
  Mental Dental proposal). P1-04 is Production Verified: the
  `organization_weekly_targets` table exists in the production project and holds
  the real Trust Tai row, read back with the service key. P1-05 requires only
  Code/Test Verified and has been at that level since P1-001; the previous
  entry withheld its share by mistake, which rule 2 does not allow.
  -> 12 x 4/6 = 8.0 and 10 x 4/6 = 6.6667
- P8 weight 8 (engine only), 5 gates, **0 met**. P8-01 and P8-02 were previously
  scored as Production Verified on table existence and code existence. Neither is
  supported: `content_sources` and `content_requests` hold 0 rows, so the composer
  and provenance path has never run in production, and `content_publish_attempts`
  holds 0 rows, so the hardened boundary has never been exercised. Both are now
  Code/Test Verified -> 8 x 0/5 = 0
- P2 to P7 and P9: no gate met at its required level yet -> 0
- Readiness 12 x 8/9 + 12 x 4/6 = 10.6667 + 8.0 = 18.6667 -> 19%.
  Engine 10 x 8/9 + 10 x 4/6 = 8.8889 + 6.6667 = 15.5556 -> 16%. P0-04 stays open and
  uncounted, deferred by explicit human decision on 2026-09-06; agents remain paused.


No phase is complete, so no phase has received its completion weight.


## P0, prove the existing build

| ID | Gate | Required level | Status | Evidence |
| --- | --- | --- | --- | --- |
| P0-01 | People and activity schema live | Production Verified | **Production Verified** | `member_activity` answers 200 in the production project with the service key |
| P0-02 | Approvals schema live | Production Verified | **Production Verified** | `approval_requests` answers 200 in the production project |
| P0-03 | Invite email end to end | Human Accepted | **Human Accepted**, full end-to-end production login verified 2026-09-06 | Closed by Tai's explicit confirmation: "All good now, i'm able to login after receiving the invite and the sign in links work as well." A real production invitation to Tai's alternate address `tayeshobajo@gmail.com` arrived in the inbox, the branded Supabase magic-link sign-in email arrived, the magic link authenticated the invited address, the repaired identity-driven claim created/recognized the workspace membership, and the Trust Tai OS production workspace opened. History: 2026-08-24 the first attempt to `diamond@trusttai.com` was refused by the provider ("This API key is not authorized to send emails from trusttai.com"). 2026-09-06 a replacement Resend key was linked, Send again on that invitation recorded a durable `user.invite_emailed` with `delivered: true`, and Tai provided screenshot evidence of the email in Diamond's Gmail inbox from `invites@trusttai.com`, 11:58 AM. Diamond's sign-in exposed the broken acceptance path (wrong-session handling on the generic sign-in screen); it was repaired the same day: the link carries the invited address and invitation id, `/auth` refuses a wrong active session without granting anything, and a session on the invited address accepts through `/api/public/settings/invite-accept` (idempotent membership upsert, invitation marked accepted). The gate is the invite email end-to-end workflow, which the alternate-address run proves; no specific recipient identity is required. See `docs/p0-human-verification-runbook.md` |
| P0-04 | Gmail send re-consent plus one real governed reply | Human Accepted | Code/Test Verified, human gate, **deferred by explicit Tai decision 2026-09-06** (sequence override only: still open, still uncounted, still in the charter) | Re-consent is no longer required: all three connected mailboxes (`tayeshobajo@gmail.com`, `hello@trust-tai.com`, `tai@trust-tai.com`) are `connected` and hold `gmail.readonly` plus `gmail.send` in production, all synced within the hour, so `sendCapability()` reports `canSend: true`. Human-send law stands: Comms drafts, flags and prepares, and only a human click sends; approved drafts without durable approval provenance are legacy-unverified and refuse Send until a person re-approves. Drafts now ground in bounded, ordered client/project/thread context with facts separated from interpretation, and only confirmed sent messages become durable relationship memory, once, via the shared event stream. External-send reconciliation is built (commit `be63741d`, 1,993 tests passing, 21 new; typecheck, lint, build clean; no migration): a reply sent manually in Gmail is matched to a waiting draft only on provable thread/person/time evidence, ambiguous matches fail closed, repeats are idempotent, and a matched draft closes as replied-from-Gmail with Send suppressed. Live read-only check: the Megan and Mental Dental drafts are unchanged, no draft carries a replied-from-Gmail mark yet, and a dry run over the production mailbox correctly matched nothing because no later outbound message exists; the reconciliation write path has therefore never executed against production. No draft anywhere carries a `rationale.send` record, so nothing has ever been sent through Gmail in production. The remaining gate is one real human send (in Comms or in Gmail) observed and reconciled, plus its idempotent replay. See `docs/p0-human-verification-runbook.md` |

| P0-05 | Add-to-Comms production proof | Production Verified | **Production Verified** | Two real `prospect.handed_over` events in the production stream (Mull IT 2026-08-25, Schaefer Marketing 2026-08-27), each with a human actor and "Nothing was sent"; matching `comms_relationships` rows carry `source=scout_handoff`, the originating `prospect_id`, the named contact and the observed/inferred/decided tiers intact. Read-only verification, nothing created |
| P0-06 | Public `content-images` bucket | Production Verified | **Production Verified** | Bucket created in the production project: public, 10 MB limit, images only. A probe object uploaded with the server key was readable anonymously at the public URL (200) and then deleted; anonymous list and anonymous upload were both refused (400). No other bucket or policy touched. `TRUST_TAI_IMAGE_BUCKET_PUBLIC` now set |
| P0-07 | Publish endpoint configured | Production Verified | **Production Verified** | Both `TRUST_TAI_PUBLISH_ENDPOINT` and `TRUST_TAI_PUBLISH_TOKEN` are present and non-empty in the runtime; values never exposed. `GET https://cmd.trusttai.com/api/public/content/publish` returned 200 with `configured:true`, `endpointConfigured:true`, `ledgerConfigured:true`. A safe authenticated production handshake to the existing trusttai.com endpoint with deliberately invalid `{}` returned 400 `idempotency_key is required`, proving bearer authentication reached validation; the no-auth control returned 401. `content_publish_attempts` was 0 before and 0 after the direct probe. `public.published_insights` on the trusttai.com database was independently read after the probe and remains 0. The website endpoint/table implementation is in the existing trusttai.com project `b3555ed3-b0dc-4def-8fee-77ff34a2cb82` / GitHub `tayeshobajo/strategy-code-canvas`; migration applied there with unique `idempotency_key` + `slug`, RLS, service-role-only. `publishQueuedItem()` writes durable `attempted` ledger state before `sendToPublisher()` and refuses if the ledger insert fails. Human approval path only queues approved items via `queueApproved()`; no unapproved item can publish. No article was published during verification. |
| P0-08 | One controlled article published and independently verified | Human Accepted | **Human Accepted**, production controlled article publish verified 2026-09-06 | Tai approved exactly one article (`citm_da7jlq4nmtn2yer2`, "How Trust Tai prioritizes roadmap milestones so founders free the most time first") on the flagged-item override path in `apr_pm7t4kmdmtn2ygo1`, with one canonical `decision` event carrying `scope: item_override` and reason "Looks good". Only that item moved exception -> approved -> queued through the canonical transitions; the other nine remain `exception` and unpublished. `publishQueuedItem()` sent it once on the stable publish key `content:cbat_ffebutsjmtn2ydym:prioritize-roadmap-milestones-trust-tai`; `content_publish_attempts` holds exactly two rows for that key, `attempted` then `executed`, the executed receipt carrying canonical URL, external id `1ffd9147-f435-4643-bda4-171fd8e2bb80` and `publishedAt` 2026-09-06T14:36:22Z. An immediate replay on the same key resolved to the same receipt, sent nothing and created no third attempt. The item is `published` then `verified`: an unauthenticated fetch of https://trusttai.com/insights/prioritize-roadmap-milestones-trust-tai returned 200 with the canonical path, the exact title in `<h1>` and the article body rendered, and the site's Insights index lists exactly one card for that slug, so exactly one website article exists for the key |

| P0-09 | Paperclip bridge verified | Production Verified | **Production Verified**, synchronized path only | `paperclip_sync_state` in production advanced twice while observed (22:15:16 -> 22:20:00 -> 22:20:21 UTC) with `consecutive_failures=0` and `last_error=null`, so the reconciliation bridge is genuinely running and writing production truth. Direct live mode is still unavailable: `PAPERCLIP_API_URL` is unset, so the app reads the projection and correctly labels itself synchronized (`docs/paperclip-hosting.md`). Agents remained paused; no reconcile or wake was triggered |


Agents remain paused for the whole of P0.

The one remaining human gate is P0-04, **deferred by explicit human decision on
2026-09-06**. Deferral is an execution-sequence override only: the gate stays open at
Code/Test Verified with its human gate intact, it is not counted as met, and it is not
removed from the charter. Active implementation focus moves to P1 by Tai's explicit
override, carrying the deferred P0-04 gate forward. P0-07 is closed at Production
Verified, P0-08 and P0-03 at Human Accepted. P0-04 has exact actions and an evidence
list in `docs/p0-human-verification-runbook.md`. No phase completion weight is awarded:
P0 is not complete until P0-04 closes, and the P0 agent-pause law stands unchanged;
moving focus does not unpause agents.



## P1, commercial truth

Slice P1-001 laid the foundation: contracts, derivation law, additive migration,
tests. Slice P1-002 wired it to production services. The migration is now applied
in the production project: every new column on `public.clients`, `public.roadmaps`
and `public.comms_touches` answers 200 with the service key, and
`public.organization_weekly_targets` exists and holds the real Trust Tai row. No
commercial fact has been invented: no tier, no MRR, no proposal amount and no
meeting kind has been written by this project, because every one of them is a
human entry. Design and law: `docs/commercial-truth.md`.

Writes go through `src/data/supabase/commercial-service.ts` using the
authenticated client, so RLS applies as the signed-in person. No service-role key
is used on any commercial path.

Slice P1-002A hardened that truth and corrected the week. The business week is now
organization-local: `src/domain/business-week.ts` finds Monday 00:00 in an IANA
timezone and returns UTC instants, tested across both DST transitions (a 167 hour
spring week and a 169 hour autumn week), and `readWeeklyScoreboard()` reads
`organizations.timezone` rather than any server clock, saying out loud when it had
to fall back to the documented canonical fallback of UTC. The Trust Tai production
organization `ee683a64-e045-4226-a8ff-4ae6590d6789` was corrected from
`Europe/London` to `America/Chicago` and read back live. Moving a client into Build
without a human-entered phase amount now throws before the client row is touched
and emits nothing. Repeating a commercial transition replays it instead of
recording it twice, and an already answered proposal cannot be reopened or
reanswered by this system. `meeting_kind` is refused on anything that was not a
meeting, on both `logTouch()` and `setMeetingKind()`. First touches now mean real
human outbound first outreach only, defined in `src/domain/first-touch.ts`: earlier
inbound contact does not disqualify a first outbound touch, earlier outbound does,
and several outbound touches to one relationship count once. Weekly targets
validate and fail closed before any write. Most importantly, a source that cannot
be read is no longer displayed as zero: `readWeeklyScoreboard()` returns a
`Sourced` result per source, so an empty table is a real 0 and a failed query is
unknown. No percentage moves on this slice: it corrects code and configuration, and
no gate newly reached its required level.

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P1-01 | Client commercial state: tier, mrr in cents, engagement dates, provenance | Production Verified | **Production Verified**, real production row written through the human UI path 2026-09-06 | Mental Dental (`4a8e054c-d0f3-4ca4-a1d8-5595cfd74a19`) read back live with `tier=run`, `mrr_cents=350000`, `renewal_at=null`, `next_review_at=null`, `commercial_updated_by=241e0261-f2f6-4f0e-bcb1-c3f84de1a76e`, `commercial_updated_at=2026-09-06T19:07:51.149Z`, and `commercial_provenance` carrying `created_manually=true`, `actor_label=tayeshobajo@gmail.com`, `because="signed retainer"`. Entered by a signed-in human in the Commercial state panel on the client page under RLS, not by service role and not by any agent. Dates were left empty because none is a real fact yet, so nothing was invented. Write path: `src/domain/client-commercial-form.ts` (10 tests) plus `setClientCommercialState()`, which writes only the facts that changed and stamps actor, time and reason |
| P1-02 | Proposals with sent and signed events on the existing prospect and roadmap lineage | Production Verified | **Production Verified 2026-09-06** on the real Mental Dental proposal. Roadmap `e51bd651-ecd5-4137-bbfa-4004ab3124e7` reads back live with `proposal_sent_at` 2026-08-01T12:00:00Z, `proposal_amount_cents` 350000, `proposal_outcome` signed, `proposal_outcome_at` 2026-08-01T12:00:00Z, `proposal_updated_by` 241e0261-f2f6-4f0e-bcb1-c3f84de1a76e. `activities` holds exactly one `proposal.sent` and exactly one `proposal.signed` event for this roadmap, both `occurred_at` 2026-08-01T12:00:00Z; existing `source_event_key`s were preserved, no duplicate event was created, and the `proposal.signed` activity provenance `observedAt` was corrected to 2026-08-01T12:00:00.000Z. The actual answer day, 2026-08-01, was stated by Tai and the row was corrected under his explicit authority, closing the data-correction gate opened 2026-09-06. Schema live in production; `recordProposalSent()` and `recordProposalOutcome()` write state on the existing lineage node and emit `proposal.sent`, `proposal.signed` or `proposal.declined`. No deal object, no second pipeline. Slice P1-005 added the human path: the Proposal panel on the client page Roadmap tab, under RLS as the signed-in person. Slice P1-006 fixed the form: the day a proposal was signed or declined is required, parsed with the same midday UTC law as the sent day, and the answered line reads `proposal_outcome_at` rather than `proposal_sent_at` |
| P1-03 | `client.tier_changed` with a human-entered Build phase amount | Production Verified | Code/Test Verified. Emitted exactly once per real tier change, with `phase_amount_cents` only when the new tier is Build; re-writing the same tier emits nothing. Tested. Nothing emitted in production, because no tier has changed |
| P1-04 | Org-level weekly targets | Production Verified | **Production Verified**. `public.organization_weekly_targets` exists in the production project with member read and admin write over `private.is_org_member` / `private.is_org_admin`, and holds the Trust Tai row (targets 10-12 first touches, 2-3 discovery, 1-2 Diagnose proposals, 20 Run clients, revenue target 2,100,000 cents), read back live. `readOrganizationWeeklyTargets()` falls back to the locked defaults when an organization has no row |
| P1-05 | Revenue derived at read time by the locked rules, never persisted weekly | Code/Test Verified | **Code/Test Verified**. `src/domain/revenue.ts` with 11 tests: `mrr_cents * 12 / 52`, explicit refusal of `/4` and `/4.345`, one-off recognition in the week of the event, and Run reading tier state only so a signed proposal cannot inflate it. `readWeeklyScoreboard()` composes the week from live state and dated events and writes nothing back |
| P1-06 | `meeting_kind` on a logged meeting, human set only | Production Verified | Code/Test Verified, schema live in production. `meeting_kind` confirmed on `public.comms_touches` by a live read; set only by a person through `logTouch({ meetingKind })` or `setMeetingKind()`, each recording who said so and when. Never read from a subject line, a calendar entry, Fathom or a transcript. No meeting classified in production |


Slice P1-004, linked working sources (this pass). Mental Dental's two working
documents were shared as a Google Doc URL and a Google Sheet URL, not as
uploaded binaries, so no `project_files` row is owed and no upload is being
asked for. The Files tab on a client page now shows "Linked working sources"
above uploaded files, read from the two canonical Projects stores
(`project_thinking_sources` and `project_connections`) with no parallel file
store: each row says External link, its kind, its honest state, its project and
the day it was linked, and opens the address in a new tab. The Figma prototype
and the development site already saved on the Mental Dental Academy project
appear there unchanged. The only missing inputs are the two Google URLs
themselves; nothing was invented for them. No schema change, no percentage
moves on this part.


Slice P1-005, the human path into a proposal (this pass). P1-02 had the law and
the service but no way for a person to use it: no screen anywhere read or wrote
proposal state. It now lives on the surface that already owns this company's
lineage, the Roadmap tab of the client page, not in a new room and not as a
second commercial store. `src/domain/proposal-form.ts` refuses what it cannot
honestly record: no amount is guessed, a missing day is not defaulted to today,
a proposal for nothing is refused, and a proposal already answered is never
reopened. Answers use the canonical vocabulary only, open, signed and declined,
and both writes stay idempotent and provenance-stamped through the existing
service. Production verification is held at a human-data gate: it needs a real
roadmap for a real company and real proposal terms, and neither exists. No
percentage moves.


## P2, Clients and Home

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P2-00 | Ordinary navigation locked to the charter: Home, Clients, Scout, Comms, Website, Ops, Studio, Pulse, Conductor, Approvals, Steward; Roadmap and Projects reachable by deep link only | Runtime Verified | **Runtime Verified** (slice P2-001A). `PRIMARY_NAVIGATION` in `src/domain/registry.ts` is the single order; `primaryNavigation()` narrows to what a person may see without reordering; Roadmap and Projects stay registered as live business rooms with their route files. 6 registry tests. Rail read back in the signed-in preview as exactly the eleven names in the charter's order |
| P2-01 | Clients book grid with the fixed hierarchy, proposed companies separate | Human Accepted | Runtime Verified, awaiting human acceptance (slice P2-001A). `/modules/clients` renders All, Run, Build, Diagnose and a separate Proposed list from `buildClientBook()`; every card carries company, tier and value, review or renewal, then one delivery line from Projects. Days are computed in the organization's own timezone (`localDaysBetween` in `src/domain/business-week.ts`), so "due today" and "overdue" flip at local midnight, not UTC. Reviews are counted from `next_review_at` only; a renewal never counts as a review. A proposal source that could not be read says so in the headline instead of reading 0. Search by company name. 25 projection tests. Read back live in the signed-in preview against the one real production client, nothing written |
| P2-02 | Manual Add Client | Human Accepted | Runtime Verified, awaiting human acceptance. `CreateClientModal` + `createClientRecord()` write name, site, logo, tier, renewal and review; idempotent on company name; emits `client.created` and, when a tier is set, `client.tier_changed`. `Add client` is shown only to people whose access level allows a write. The dialog opens, validates and cancels in the signed-in preview; it was **not** submitted, so no client has been created in production and the write itself remains Code/Test Verified. Writing borrows `roadmap.write` until a canonical `clients.write` permission exists (comment in `src/domain/app-access.ts`); RLS governs the actual insert |
| P2-03 | Client page shell: Overview, Roadmap, Projects, Relationship, Site, Files, owning no state | Human Accepted | Runtime Verified, awaiting human acceptance (slice P2-001A). `/modules/clients/$clientId` carries all six tabs, addressed by `?tab=`. Every section names its owning room and offers `Open in <room>`: Roadmap outcome, current stage and next move from Roadmap; delivery from Projects; decisions from Approvals read-only with no deciding controls; review cadence from the client record; relationship snapshot from Comms; site health from Website; the shared event stream filtered to this company and its roadmaps, projects and people. A source that could not be read says "could not be read just now"; a source with nothing says "not recorded yet"; the two are never conflated. Site and Files are honest about ownership: no site record or file is linked to a client yet, and the tabs say so rather than inventing one. 10 shell tests. All six tabs read back live in the signed-in preview against the real production client, nothing written |
| P2-04 | Home This Week, four numbers, derived only, no charts | Human Accepted | Not started |
| P2-05 | Today ordering: obligation at risk, floor breach, decision opportunity | Code/Test Verified | Not started |

P2-00 is a slice-added gate, not a charter gate; it carries no weight in the
percentages. P2-01 to P2-03 require Human Accepted, so P2 still contributes 0
until Tai accepts them in the preview.

Slice P2-001A, presentation correction (this pass). The listing header now reads
"Clients" with the charter's exact subtitle, "Everyone you serve, one door each.",
and the real-data outcome line (Run clients, reviews due, proposals awaiting a
decision) sits below it, derived from the same `buildClientBook()` snapshot the
grid and the view counts use, so no number on this page can contradict another.
Card hover and keyboard focus were brought to the specified restraint: a 2px lift
on the tile, the identity image alone scaling to 1.03, a 200ms transition, a
royal border with a faint royal tint, and "Open client ->" revealed; no fact
moves or hides, and focus-visible receives the same treatment as hover, so touch
never depends on hover. Deviations: no card overflow menu exists in this room, so
no glyph correction was required (no four-dot glyph is present anywhere in the
Clients surface); featured imagery remains the recorded logo or the monogram
fallback, because the client schema carries no OG/featured image column and
inventing a parallel store is forbidden. Status is unchanged: P2-01 to P2-03 stay
Runtime Verified, awaiting human acceptance, and the 11% / 9% baselines do not
move, since no gate reached a new required level. Verified this pass: `tsgo
--noEmit` clean, `vitest run` 1925 passing across 162 files, eslint clean on the
two changed files, `bun run build` succeeded.

Slice P2-001A, Site, Files and company imagery (this pass). Three gaps closed
without moving ownership. Site now reads the Website room for real: intake
recorded by this company, matched only on the exact web address a person typed
(host compared without scheme or `www.`) or the exact company name, never on
resemblance; a Website schema that was never applied reports as unreadable, an
applied schema with no matching intake reports as an absence, and the two are
never conflated. Files now read the Projects room for real: every file on the
projects that name this company, opened through a short-lived signed link, with
"no project names this company" and "projects exist but nothing uploaded" kept
as separate, honest sentences. Company imagery became a real upload: the public
`client-logos` bucket was created in the production project, the new signed
endpoint `POST /api/public/clients/logo` proves active membership from the
caller's own token, re-reads the client row under that same session, stores the
file with the service key (the bucket is not writable by a person's session)
and records the durable address on the canonical client row, removing the
object again if the record cannot be written. `docs/clients-image-schema.sql`
promotes that address to a first-class `clients.logo_url` column when Tai runs
it; the read path prefers the metadata value, so applying it is safe at any
time. Deviation: DDL cannot be executed from this environment (no management
credential and no SQL RPC on the shared project), so the column itself is
documented, not applied. Status unchanged: P2-01 to P2-03 stay Runtime Verified
awaiting human acceptance, and the 11% / 9% baselines do not move. Verified this
pass: `bunx tsgo --noEmit` clean, `bunx vitest run` 1930 passing across 162
files (5 new site-matching tests), eslint clean on the nine changed files,
`bun run build` succeeded, and the new endpoint refuses an anonymous caller with
401 in the running preview. The upload itself has not been exercised against
production, so it remains Code/Test Verified.



## P3, Roadmap and Projects handoff

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P3-01 | Milestone outcome metric: key, label, unit, direction, baseline, target | Production Verified | Not started |
| P3-02 | Measurements with value, measured_at, source, provenance, recorded_by | Production Verified | Not started |
| P3-03 | Manual roadmap, milestone, Point A, Point B, measurement paths | Human Accepted | Not started |
| P3-04 | One-line delivery projection from Projects on the roadmap | Runtime Verified | Not started |
| P3-05 | Decisions displayed from Approvals, no duplicate controls | Code/Test Verified | Not started |

## P4, Scout and Sentinel

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P4-01 | Curated watchlist, staged upload before an explicit save | Production Verified | Not started |
| P4-02 | Bounded scheduled sweep, refresh in place | Production Verified | Not started |
| P4-03 | Movement only on an observed evidence change, with what changed and when | Code/Test Verified | Not started |
| P4-04 | Coverage reported as counts only | Runtime Verified | Not started |
| P4-05 | Existing Scout laws unchanged and passing | Code/Test Verified | Holds today, re-checked per slice |

## P5, Comms

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P5-01 | At risk means only reply owed, promise open, or a dated reason unacted | Code/Test Verified | Not started |
| P5-02 | Judgment before draft, grounding shown | Runtime Verified | Partly implemented today, not verified against this charter |
| P5-03 | Voice note as a first-class logged touch, counted as a first touch | Production Verified | Not started |
| P5-04 | Manual `meeting_kind` logging | Production Verified | Not started |
| P5-05 | Existing Comms laws unchanged and passing | Code/Test Verified | Holds today, re-checked per slice |

## P6, Pulse

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P6-01 | Canon groups only: Act now, Evaluate, Watch closely, Good to know | Code/Test Verified | Needs verification against the current projection |
| P6-02 | Deterministic momentum floors that never override a gate | Code/Test Verified | Not started |
| P6-03 | Same snapshot as Home | Runtime Verified | Not started |
| P6-04 | Feedback: Accept, Not now, Not useful, Why am I seeing this? | Runtime Verified | Implemented, not verified at this level |

## P7, Keep

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P7-01 | Review coverage, named Review coverage and never retention | Human Accepted | Not started |
| P7-02 | `next_review_at` satisfied only by a logged `roadmap_review` | Code/Test Verified | Not started |
| P7-03 | Renewal recorded by hand | Production Verified | Not started |
| P7-04 | Every manual path in the manual override law is reachable | Human Accepted | Not started |

## P8, Tell, post launch

| ID | Gate | Required level | Status | Evidence |
| --- | --- | --- | --- | --- |
| P8-01 | Content Engine v1 in Studio, composer, sources, provenance | Production Verified | Code/Test Verified, corrected downward | Tables exist and batch `cbat_ffebutsjmtn2ydym` holds 10 articles, but `content_sources` and `content_requests` hold **0 rows** in production, so the composer, source capture and provenance path has never actually run there. Table existence was mistaken for a production run |
| P8-02 | Publish queue states with an attempt ledger, hardened boundary | Production Verified | Code/Test Verified, corrected downward | The boundary and its ledger-first ordering are covered by domain tests, but `content_publish_attempts` holds **0 rows** in production, so the hardened path has never been exercised against a real endpoint |
| P8-03 | Featured image provider connected | Production Verified | Not started, post launch, not a P0 blocker | P0-06 cleared the store: credentials and a durable public bucket both exist. `prepareFeaturedImage()` still refuses by design because no generation path is written. `GET /api/public/content/image` reports `ready:false`, `generatorImplemented:false`. Under current Content Engine law this does **not** block P0-08: `image.url` is nullable in the publish payload and the publish boundary never asks whether an image exists. The only cost of publishing without one is a weaker social card |
| P8-04 | One article published with a verified canonical URL | Human Accepted | Blocked, see P0-07 and P0-08 | Nothing published |


| P8-05 | A published article shown to have changed something measurable | Human Accepted | Not started | Depends on P3 measurements |

## P9, intelligence expansion, post launch

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P9-01 | Conductor depth beyond the current room adapters | Human Accepted | Not started |
| P9-02 | Steward interpretation depth | Human Accepted | Not started |
| P9-03 | Canon governance in production use | Production Verified | Not started |
| P9-04 | Sentinel, Scribe, Herald released one gate at a time | Human Accepted | Not started, agents paused |

## Carried forward, not yet placed in a phase

- [ ] First sign-in lifecycle event in the shared activity stream
