# Steward bounded agent and Scout-send completion

## Operating contract

- Internal AI work starts only when a signed-in person explicitly assigns a task.
- The only model for this path is `openai/gpt-6-astra`, called server-side through Trust Tai's single Intelligence Runtime.
- Low-risk internal preparation may complete only with a durable artifact and evidence references.
- Anything resembling sending, publication, payment, approval, a commercial commitment, pricing, scope, dates, deletion, deployment, contact, or outreach stops at **Needs approval**.
- Paperclip remains the execution source of truth for imported Paperclip tasks. The internal runner has its own durable receipt.
- No agent entry point can send a Comms message.

## Acceptance evidence

| ID | Criterion | Evidence | Result | Remaining owner |
|---|---|---|---|---|
| AE1 | One explicit assignment starts at most one run | CODE: deterministic organization/task idempotency key and unique proposed index | Pass in code | Codex: apply SQL |
| AE2 | Inactive and cross-workspace callers fail closed | CODE: literal active membership and organization-scoped task reads; authenticated receives SELECT only | Pass in code | Codex: live RLS proof |
| AE3 | High-risk work cannot execute | CODE/TEST: deterministic risk gate | Pass | — |
| AE4 | No-context tasks do not guess | CODE/TEST | Pass | — |
| AE5 | Low-risk work uses Astra through the server only | CODE/TEST: literal model, server-only module, and runtime fragmentation guard | Pass | Live model smoke test after schema |
| AE6 | Completion requires a saved artifact and evidence | CODE/TEST | Pass | Live persistence proof |
| AE7 | Failure leaves task honestly unresolved | CODE/TEST boundary | Pass in code | Live persistence proof |
| AE8 | Agent activity requires explicit agent provenance | CODE: activity payload contains agent/run/evidence identity | Pass in code | Signed-in feed proof |
| AE9 | Existing Steward Agents task list remains unified | CODE: agent-owned manual tasks use the existing Agents filter | Pass | Signed-in visual proof |
| AE10 | Home can create and assign an AI task | CODE: existing drawer enabled and calls the same runner | Pass in code | Signed-in flow proof |
| AE11 | No autonomous external action exists | CODE: runner has only model/database access; risk gate forbids external action | Pass | — |

| ID | Criterion | Evidence | Result | Remaining owner |
|---|---|---|---|---|
| SC1 | Scout handoff creates/reuses one exact outreach task | CODE: prospect correlation key and proposed unique index | Pass in code | Codex: apply SQL |
| SC2 | Linkage is workspace + canonical prospect, never title/name | CODE/TEST | Pass | — |
| SC3 | Gmail and Resend share the same post-settlement hook | CODE: hook is inside shared `settleDelivery` | Pass | — |
| SC4 | Only recorded provider-confirmed `sent` can complete | CODE/TEST | Pass | Live provider proof not run |
| SC5 | Failed/unknown/attempting never complete | TEST | Pass | — |
| SC6 | Retry cannot complete twice | CODE: conditional update plus idempotent activity key | Pass in code | Live concurrency proof |
| SC7 | Downstream failure never suggests resending | CODE: send outcome remains authoritative; reconciliation is caught | Pass | — |
| SC8 | Home shows check and crossed title | Existing component behavior for durable `complete` state | Pass in code | Signed-in visual proof |
| SC9 | No send, publish, schema application, or production schedule action occurred | PROCESS | Pass | — |

## Verification boundary

The SQL in `docs/migrations/proposed/20260923190000_steward_agent_runs_and_source_links.sql` is proposed and unapplied. Until Codex applies and verifies it, durable run execution and signed-in end-to-end acceptance remain blocked. Tests use deterministic mocks; they do not prove a live model call or a real send.

The implementation verification completed with 319 test files / 3,520 tests passing, a clean type check and diff check, and a healthy preview build. This includes the guard that prevents room-specific code from calling a model provider directly. No live model request, message send, schema application, publish, payment, or production mutation was performed.
## 2026-09-23 — Live walkthrough, AI page, timeline, Scout People context

| Row | Evidence | Result | Owner |
|---|---|---|---|
| H1–H5 Home walkthrough | `scripts/qa/home-e2e.py` run in preview sandbox | BLOCKED: no signed-in session (`no_supabase`); nothing marked passed | Tai/Codex signed-in run |
| A1–A5 Bounded agent live run | Code + mocks | CODE only; live run needs `steward_agent_runs` migration applied and a signed-in session | Codex (SQL), Tai |
| P1–P5 Scout People context | `src/domain/steward-agent-people.ts` + tests; runner loads saved people for the exactly linked prospect as the caller (RLS), max four, validates every named person is cited and saved | CODE pass (3 tests) | Live answer pending signed-in run |
| T1–T5 Timeline | `/modules/steward/timeline`, `src/domain/steward-task-timeline.ts` + tests | CODE pass; unknown actors/times show "Unknown"/"Not recorded" | Signed-in visual check |
| Q1–Q5 Trust Tai AI page | `/modules/steward/ai` queue, status, response/evidence, retry; owners/admins queue | CODE pass; honest unavailable state when run storage absent | Signed-in visual check |

Full suite: 321 files / 3,526 tests; typecheck clean. No SQL applied, no model call, no send, no publish.

### Signed-in run, 2026-09-23 23:00 UTC (Tai's own session via one-time sign-in link, localhost preview)
- H1 PASS signed in as the workspace owner. H2 PASS task created and shown on Home; completion showed check + line-through, checkbox locked, still complete after reload (H4 PASS).
- Defect found and fixed: teammate list read selected a non-existent `organization_memberships.id`, so every people list (assign panel, timeline names) was empty. Assign panel now lists members; other members' names show "A colleague" because profiles are not readable to this user (RLS, left unchanged).
- T1 PASS Timeline lists the task after making names optional. Q1 PASS task queued on Trust Tai AI page; AI run did not start: preview server lacks its server write access and `steward_agent_runs` is absent. Error copy no longer exposes setup names.
- H3 (Scout row crosses after a Comms send) NOT RUN: needs a real sent message; no send was made.
- QA rows (`QA-` prefix) deleted; session file removed.

## Round: live queue, campaigns, Scout profiles, send-triggered agent (2026-09-23)

Evidence types: CODE (unit/mocked tests), LIVE (signed-in browser), BLOCKED (named dependency).
Build: full suite 325 files / 3,541 tests, `tsgo --noEmit` clean. Auth status `no_supabase`.

| Row | Evidence | Result | Owner |
|---|---|---|---|
| L1 run settles Queued → In progress → Completed/Needs approval | BLOCKED | Needs a fresh sign-in link and `steward_agent_runs` applied | Tai (link), Codex (SQL) |
| L2 run in Home AI feed as agent work | CODE (feed filters `actor_is_agent`) / LIVE BLOCKED | same | same |
| L3 Scout row shows agent status; crossed only on evidence | CODE | runner completes only after saved artifact | — |
| L4 reload keeps it; QA rows cleaned | BLOCKED | walkthrough `scripts/qa/home-e2e.py` extended | Tai |
| C1 campaign: name, template, placeholders, eligible emails only | CODE `scout-campaign.test.ts` | PASS | — |
| C2 one Comms draft per recipient, linked to Scout | CODE (reuses `prepareFirstMessageDraft`, `campaign_key` in rationale) | PASS | — |
| C3 send queue states; nothing sends without approval | CODE | PASS | — |
| C4 unfillable placeholders block | CODE | PASS | — |
| C5 no duplicate drafts/sends | CODE (dedupe + existing-draft idempotency) | PASS | — |
| Campaign storage | PROPOSED `docs/migrations/proposed/20260923230000_scout_campaigns.sql` | Unapplied; UI says campaigns can't be saved yet | Codex |
| D1 Scouts tab, accurate counts, unknown ≠ 0 | CODE `steward-scouts.test.ts` | PASS | — |
| D2 filters before pagination, 12/page | CODE | PASS | — |
| D3 card opens profile | CODE | PASS | — |
| P1 profile shows people, tasks, runs | CODE (`ProfileWork` on company People tab) | PASS; LIVE pending | Tai |
| P2 "Ask AI" creates linked agent task; answer cites saved people/prospect refs; invented refs rejected | CODE `steward-agent-prospect-context.test.ts` | PASS | — |
| P3 missing facts reported unknown | CODE | PASS | — |
| S1 only recorded `sent` + exact prospect link triggers | CODE `comms-scout-follow-up.server.test.ts` | PASS | — |
| S2 first-message task crossed; one follow-up, runs once per delivery | CODE | PASS | — |
| S3 follow-up is internal prep only | CODE | PASS | — |
| S4 AI start failure keeps completion | CODE | PASS | — |

The follow-up agent runs as the sending person's own token (RLS); with no token it stays queued and never impersonates. No send, publish, SQL application or provider call occurred.
