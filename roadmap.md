# Trust Tai OS, execution ledger

The canonical plan is `docs/production-plan.md`. The canon in
`docs/architecture-canon.md` outranks both. This file is the live status only.

Status vocabulary: Not started, Implemented, Code/Test Verified, Runtime Verified,
Production Verified, Human Accepted. Lovable saying done is at most Implemented.

## Progress

**Production Readiness: 11%** (P0 to P7)
**Full Engine: 9%** (P0 to P9)

Working (corrected in slice P0-001A, extended in P1-002):

- P0 weight 12 (readiness) / 10 (engine), 9 gates, 5 met -> 12 x 5/9 = 6.7 and
  10 x 5/9 = 5.6
- P1 weight 12 / 10, 6 gates, **2 met**. P1-04 is Production Verified: the
  `organization_weekly_targets` table exists in the production project and holds
  the real Trust Tai row, read back with the service key. P1-05 requires only
  Code/Test Verified and has been at that level since P1-001; the previous
  entry withheld its share by mistake, which rule 2 does not allow.
  -> 12 x 2/6 = 4.0 and 10 x 2/6 = 3.3
- P8 weight 8 (engine only), 5 gates, **0 met**. P8-01 and P8-02 were previously
  scored as Production Verified on table existence and code existence. Neither is
  supported: `content_sources` and `content_requests` hold 0 rows, so the composer
  and provenance path has never run in production, and `content_publish_attempts`
  holds 0 rows, so the hardened boundary has never been exercised. Both are now
  Code/Test Verified -> 8 x 0/5 = 0
- P2 to P7 and P9: no gate met at its required level yet -> 0
- Readiness 6.7 + 4.0 = 10.7, rounded to 11. Engine 5.6 + 3.3 = 8.9, rounded to 9.


No phase is complete, so no phase has received its completion weight.


## P0, prove the existing build

| ID | Gate | Required level | Status | Evidence |
| --- | --- | --- | --- | --- |
| P0-01 | People and activity schema live | Production Verified | **Production Verified** | `member_activity` answers 200 in the production project with the service key |
| P0-02 | Approvals schema live | Production Verified | **Production Verified** | `approval_requests` answers 200 in the production project |
| P0-03 | Invite email end to end | Human Accepted | Pending, human gate, blocked on Resend domain verification | The path has already executed in production: `user.invited` then `user.invite_emailed` for `diamond@trusttai.com` on 2026-08-24, the latter with `delivered: false` and the provider's exact refusal, "This API key is not authorized to send emails from trusttai.com". So route, audit trail and provider call are proven; only sender-domain authorisation is missing. The stored key is send-only restricted (`GET /domains` returns `401 restricted_api_key`), so no provider-side delivery log can be read. See `docs/p0-human-verification-runbook.md` |
| P0-04 | Gmail send re-consent plus one real governed reply | Human Accepted | Re-consent done, governed reply pending, human gate | Re-consent is no longer required: all three connected mailboxes (`tayeshobajo@gmail.com`, `hello@trust-tai.com`, `tai@trust-tai.com`) are `connected` and hold `gmail.readonly` plus `gmail.send` in production, all synced within the hour, so `sendCapability()` reports `canSend: true`. One draft is already `approved` and unsent; no draft anywhere carries a `rationale.send` record, so nothing has ever been sent through Gmail in production. The remaining gate is one real human-approved send plus its idempotent replay. See `docs/p0-human-verification-runbook.md` |

| P0-05 | Add-to-Comms production proof | Production Verified | **Production Verified** | Two real `prospect.handed_over` events in the production stream (Mull IT 2026-08-25, Schaefer Marketing 2026-08-27), each with a human actor and "Nothing was sent"; matching `comms_relationships` rows carry `source=scout_handoff`, the originating `prospect_id`, the named contact and the observed/inferred/decided tiers intact. Read-only verification, nothing created |
| P0-06 | Public `content-images` bucket | Production Verified | **Production Verified** | Bucket created in the production project: public, 10 MB limit, images only. A probe object uploaded with the server key was readable anonymously at the public URL (200) and then deleted; anonymous list and anonymous upload were both refused (400). No other bucket or policy touched. `TRUST_TAI_IMAGE_BUCKET_PUBLIC` now set |
| P0-07 | Publish endpoint configured | Production Verified | Not started, blocked on external configuration | `TRUST_TAI_PUBLISH_ENDPOINT` and `TRUST_TAI_PUBLISH_TOKEN` are absent and `GET /api/public/content/publish` reports `endpointConfigured:false`. There is no safe in-repo implementation path: trusttai.com is a Next.js site served from Cloudflare, is not part of this repository, and is not a project on this account, so no CMS or API adapter exists to reuse. The full external contract (endpoint, bearer auth, idempotency-key behaviour, request and receipt schema, verification expectation) is written in `docs/p0-human-verification-runbook.md`; once the route exists only the two secrets are needed, no code change |
| P0-08 | One controlled article published and independently verified | Human Accepted | Pending, human gate, blocked by P0-07 only | Nothing published. P8-03 is **not** a blocker: `image.url` is nullable in the publish payload and `publishQueuedItem()` never requires an image. A batch of 10 posts is already awaiting review (`apr_pm7t4kmdmtn2ygo1`); `content_publish_attempts` holds 0 rows. Exact sequence and evidence in `docs/p0-human-verification-runbook.md` |

| P0-09 | Paperclip bridge verified | Production Verified | **Production Verified**, synchronized path only | `paperclip_sync_state` in production advanced twice while observed (22:15:16 -> 22:20:00 -> 22:20:21 UTC) with `consecutive_failures=0` and `last_error=null`, so the reconciliation bridge is genuinely running and writing production truth. Direct live mode is still unavailable: `PAPERCLIP_API_URL` is unset, so the app reads the projection and correctly labels itself synchronized (`docs/paperclip-hosting.md`). Agents remained paused; no reconcile or wake was triggered |


Agents remain paused for the whole of P0.

The four human gates (P0-03, P0-04, P0-07, P0-08) have exact actions and evidence
lists in `docs/p0-human-verification-runbook.md`. No gate closed in this slice, so
the percentages above are unchanged.


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
| P1-01 | Client commercial state: tier, mrr in cents, engagement dates, provenance | Production Verified | Code/Test Verified, schema live in production. Columns confirmed on `public.clients` by a live read; `setClientCommercialState()` writes only the facts it is given and stamps actor, time and reason into `commercial_provenance`. No client has been given a tier or an MRR yet, so no production row proves the write |
| P1-02 | Proposals with sent and signed events on the existing prospect and roadmap lineage | Production Verified | Code/Test Verified, schema live in production. Proposal columns confirmed on `public.roadmaps` by a live read; `recordProposalSent()` and `recordProposalOutcome()` write state on the existing lineage node and emit `proposal.sent`, `proposal.signed` or `proposal.declined`. No deal object, no second pipeline. No proposal recorded in production |
| P1-03 | `client.tier_changed` with a human-entered Build phase amount | Production Verified | Code/Test Verified. Emitted exactly once per real tier change, with `phase_amount_cents` only when the new tier is Build; re-writing the same tier emits nothing. Tested. Nothing emitted in production, because no tier has changed |
| P1-04 | Org-level weekly targets | Production Verified | **Production Verified**. `public.organization_weekly_targets` exists in the production project with member read and admin write over `private.is_org_member` / `private.is_org_admin`, and holds the Trust Tai row (targets 10-12 first touches, 2-3 discovery, 1-2 Diagnose proposals, 20 Run clients, revenue target 2,100,000 cents), read back live. `readOrganizationWeeklyTargets()` falls back to the locked defaults when an organization has no row |
| P1-05 | Revenue derived at read time by the locked rules, never persisted weekly | Code/Test Verified | **Code/Test Verified**. `src/domain/revenue.ts` with 11 tests: `mrr_cents * 12 / 52`, explicit refusal of `/4` and `/4.345`, one-off recognition in the week of the event, and Run reading tier state only so a signed proposal cannot inflate it. `readWeeklyScoreboard()` composes the week from live state and dated events and writes nothing back |
| P1-06 | `meeting_kind` on a logged meeting, human set only | Production Verified | Code/Test Verified, schema live in production. `meeting_kind` confirmed on `public.comms_touches` by a live read; set only by a person through `logTouch({ meetingKind })` or `setMeetingKind()`, each recording who said so and when. Never read from a subject line, a calendar entry, Fathom or a transcript. No meeting classified in production |



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
