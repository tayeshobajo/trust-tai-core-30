# Agency journey build, round progress

One row per acceptance criterion, per round. Code, synthetic model evaluation, real
persisted execution, production deployment and team acceptance are distinct kinds of
evidence and are never merged. Completing this queue does not mean 100%.

Canonical acceptance ids C01–C22, T01–T05 and P1–P8 are preserved elsewhere and are
untouched by this file.

---

## Round 1/10 — Establish the journey and shared handoffs

**Exact submitted prompt (verbatim):**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 1/10: 1. Establish the journey and shared handoffs
> Audit existing implementation before building. Create docs/agency-journey-contract.md mapping each app to inputs, owned state, outcome, decision owner and handoff. Define one synthetic client fixture used by every subsequent round.
> A1.1 Map source→qualify→discovery→roadmap→proposal→agreement/onboarding→delivery→care/outcome review; lost/deferred/reopened paths included.
> A1.2 Same company/person IDs and source references survive all steps; define idempotent handoff keys and owning-service writes, prevent partial handoff from appearing complete.
> A1.3 Every active item has accountable owner or visible unassigned state, next action, evidence and blocking reason. Due dates only from authorized decisions.
> A1.4 Capability inventory differentiates working/code-only/missing; old v1 docs cannot be treated as live truth. List actual schema/integration dependencies.
> A1.5 Specify role-based Home and one client workspace; preserve navigation initially, avoid new dashboards. Fix only minimal handoff foundation needed. Deliver acceptance fixture and implement reusable contract/validation through existing services.

**Changes in this round**

| File | Change |
| --- | --- |
| `src/domain/agency-journey.ts` | New. Pure journey contract: eight stages with owning room, inputs, owned state, outcome and decision owner; lost/deferred/reopened path rules; `JourneySubject` identity; `idsSurvive`; idempotent `handoffKey`; `validateHandoff` with owning-service and receipt rules; `itemReadiness`. |
| `src/data/fixtures/agency-journey-fixture.ts` | New. The single synthetic client fixture (Northwind Fixture Ltd). No real company, person, mailbox, credential or customer data. |
| `src/domain/agency-journey.test.ts` | New. 18 tests over journey shape, off-path rules, id survival, key idempotency, handoff validation and item readiness. |
| `docs/agency-journey-contract.md` | New. Per-app mapping, handoff rules, capability inventory, Home and client workspace specification. |
| `docs/agency-journey-build-progress.md` | This file. |

No route, schema, auth, send, styling or Comms behaviour was changed. No migration was
applied. Unfinished Comms acceptance work, the preserved QA session
`9b329dbe-02ca-40d6-9f54-9ec728c64446` and the unapplied lessons SQL are untouched.

**Evidence and build**

- `bunx vitest run agency-journey` — 18/18 pass, 1 file.
- `bunx tsgo --noEmit` — clean.
- Build observability: `build OK`.
- Evidence kind: **code and synthetic fixture only**. No live persisted execution, no
  authenticated screen verification, no deployment, no team acceptance.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A1.1 | Source→qualify→discovery→roadmap→proposal→agreement/onboarding→delivery→care mapped, with lost/deferred/reopened | none | `JOURNEY` table in `src/domain/agency-journey.ts`; contract doc §1; tests "journey shape", "allows lost, deferred and reopened" | PASS-CODE | Agent | Rooms adopt the stage vocabulary in later rounds |
| A1.2 | Ids and source refs survive; idempotent handoff keys; owning-service writes; partial handoff cannot read as complete | A1.1 | `idsSurvive`, `handoffKey`, `validateHandoff`, `isHandoffComplete`; tests "identity survival", "handoff keys", "handoff validation" | PASS-CODE | Agent | Wire validation into the Scout→Comms and Roadmap→Projects call sites in a later round |
| A1.3 | Accountable owner or visible unassigned, next action, evidence, blocking reason; due dates only from authorised decisions | A1.1 | `itemReadiness`; tests "active items" (4) | PASS-CODE | Agent | Surface the same read in the client workspace when that round runs |
| A1.4 | Capability inventory separating working / code-only / missing, with real schema and integration dependencies | repo read | Contract doc §4, classified from `src/data/supabase/*`, `src/routes/modules.*`, registry; not from v1 docs | PASS-CODE | Agent | Re-verify any row marked "working" against live records when authenticated access exists |
| A1.5 | Role-based Home and one client workspace specified; navigation preserved; only minimal handoff foundation built | A1.1–A1.3 | Contract doc §5; no new route, dashboard or top-level app added in this round | PASS-CODE (specification) | Tai to confirm scope | Build against the existing `/` and `/modules/clients/$clientId` in the round that queues it |

**Open and blocked**

- Live verification of any inventory row, and of the contract in real records, is
  **blocked**: this environment has no authenticated session and no live evidence was
  produced. Owner: Codex.
- Tai acceptance of the journey mapping and of the Home / client workspace
  specification is **awaiting Tai**. Not marked by the agent.
- Round 1 completion does not advance any Comms acceptance row.
