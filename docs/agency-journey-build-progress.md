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

---

## Round 2/10 — Make AI execute repeatable preparation reliably

**Exact submitted prompt (verbatim):**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 2/10: 2. Make AI execute repeatable preparation reliably
> Implement common execution through existing jobs/providers, not competing automation framework.
> A2.1 Each supported job has trigger, authorized scope, input revision, output record/owner, status, retry policy and idempotency key.
> A2.2 Duplicate events and retries don't duplicate work; bounded retries/backoff, timeouts, cancellation and operator recovery; uncertain external outcomes never auto-retry.
> A2.3 Use deterministic code for arithmetic/state checks; real model for synthesis/judgment. Capture actual provider/model/prompt/input references, validation and usage/cost when available.
> A2.4 Workspace access checked at execution; changed/revoked input invalidates stale output; source material cannot override instructions or expand permissions.
> A2.5 Build disabled-by-default triggers for eligible new enquiry→qualification packet, new conversation→summary/action suggestions, milestone change→status draft. Run synthetic flows and persist outputs.
> A2.6 Per-job and workspace limits/stop switch; explicit configuration gaps, no infinite agent loops. Show friendly Prepared/Needs your decision/Could not finish states. Admin detail stays secondary.

**Audit before building**

No competing framework was added. Synthesis goes through the existing single
reasoning boundary `src/lib/intelligence-runtime.server.ts` (guarded by
`src/lib/intelligence-runtime-boundary.ts`), which is the only module allowed to
reach a provider. Runs, fingerprints and cadence in `src/data/intelligence/engine/runs.ts`
and the runtime protocol in `src/data/intelligence/runtime/` were read and left
untouched. Comms review, delivery and lessons work was not modified.

**Changes in this round**

| File | Change |
| --- | --- |
| `src/domain/preparation-jobs.ts` | New. The shared contract: three job specs with trigger, scope (`writes: preparation_output` only, plus an explicit never-does list), decision owner, retry policy, timeout, `enabledByDefault: false` and required configuration; `preparationKey`; status set and plain-word labels; `outputIsCurrent`; `retryDecision`; `mayRun` with limits, stop switch and configuration gaps; `boundedInstructions` and `materialBlock`. |
| `src/lib/preparation-runner.server.ts` | New. The one runner: execution-time access check, policy gate, idempotent load, revision recheck, deterministic read first, synthesis through the reasoning boundary, timeout, cancellation, answer validation, `recoveryDecision`. Writes one record kind through an injected store. |
| `src/data/fixtures/preparation-sandbox.ts` | New. In-memory store, fake model caller, sandbox policy, and the three synthetic reads, built on the Round 1 client fixture. No real data. |
| `src/components/tt/preparation-state.tsx` | New. Friendly state badge and result card in the existing white-card style; admin detail hidden behind `showDetail`. Not wired into any route in this round. |
| `src/domain/preparation-jobs.test.ts`, `src/lib/preparation-runner.server.test.ts` | New. 31 tests. |
| `docs/migrations/proposed/20260916130000_preparation_outputs.sql` | New, **not applied**. `preparation_outputs` + `preparation_policy`, least-privilege grants (no DELETE/TRUNCATE for any application role), RLS by active membership, immutable request identity and model record. |

No route, navigation, styling token, schema, auth, Comms or send behaviour changed.
No migration was applied. QA session `9b329dbe-02ca-40d6-9f54-9ec728c64446` untouched.

**Evidence and build**

- `bunx vitest run preparation` — 31/31 pass across 2 files.
- `bunx tsgo --noEmit` — clean. Build observability: `build OK`.
- Evidence kind: **code plus synthetic sandbox execution**. No real model call, no
  persisted database output, no deployment, no team acceptance.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A2.1 | Trigger, authorized scope, input revision, output record/owner, status, retry policy, idempotency key per job | Round 1 | `PREPARATION_JOBS`, `preparationKey`, `PreparationOutput`; tests "job contract", "idempotency" | PASS-CODE | Agent | Bind each trigger to its room's real event when the store lands |
| A2.2 | Duplicates and retries do not duplicate work; bounded backoff, timeout, cancellation, operator recovery; uncertain never auto-retried | A2.1 | `retryDecision`, runner duplicate/running/uncertain short-circuits; tests "duplicates, retries and cancellation" (6) | PASS-CODE + synthetic | Agent | Re-prove against the real store once the schema is applied |
| A2.3 | Deterministic code for arithmetic/state, model for synthesis; capture provider/model/prompt/input refs, validation, usage/cost when available | A2.1 | Runner computes `figures` before any model call and never accepts figures from the model; `ModelUse` records provider, model, `instructionsRef`, `inputRefs`, optional usage/cost; unreadable answers refused | PASS-CODE + synthetic | Agent | Usage/cost values remain unverified until a real gateway call runs |
| A2.4 | Access checked at execution; changed/revoked input invalidates stale output; material cannot override instructions or widen permissions | A2.1 | `verifyAccess` at execution (default `requireRuntimeAccess`), revision recheck, `outputIsCurrent`, `boundedInstructions` + `materialBlock`; tests include a planted "ignore all previous instructions" string that travels only as wrapped material | PASS-CODE + synthetic | Agent | Live membership refusal still needs an authenticated run |
| A2.5 | Disabled-by-default triggers for enquiry packet, conversation summary, milestone status draft; synthetic flows run and outputs persisted | A2.1–A2.4 | All three specs `enabledByDefault: false` and `PREPARATION_POLICY_DEFAULT.enabledJobs = []`; three synthetic flows executed and stored in the sandbox store | PASS-CODE + synthetic; **persistence to the database BLOCKED** | Agent / Codex | Codex reviews `20260916130000_preparation_outputs.sql`; no trigger is wired to a live event in this round |
| A2.6 | Per-job and workspace limits, stop switch, explicit configuration gaps, no infinite loops; friendly states with admin detail secondary | A2.1 | `mayRun`, `configGaps`, `PREPARATION_POLICY_DEFAULT`; bounded `maxAttempts` with no self-scheduling anywhere in the runner; `PREPARATION_STATE_LABEL` and `PreparationStateBadge` / `PreparationResult` | PASS-CODE | Agent / Tai | Surface the states in a room in a later round; Tai to confirm limit defaults |

**Open and blocked**

- Real persisted execution is **blocked** on the unapplied SQL proposal. Owner: Codex.
- A real provider call (and therefore genuine provider, model, token and cost capture)
  is **not performed**. Owner: a later authorised round.
- No trigger is armed anywhere; every job stays off until an authorised person enables it.
- Live authenticated verification remains unavailable in this environment. Owner: Codex.
- Round 2 advances no Comms acceptance row and implies no completion.

---

## Round 3 of 10 — Source qualified opportunities

**Exact submitted prompt**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 3/10: 3. Source qualified opportunities
> Connect Website and Scout using existing sources and permitted integrations.
> A3.1 Enquiry retains source/time/consent context and links to canonical company/person without duplicate creation on retry.
> A3.2 AI prepares fit rationale, evidence URLs/dates, business need, unknowns and suggested first move against explicit ICP. Unsupported sources remain unavailable.
> A3.3 Separate facts/inferences and relevance from invented intent/budget. Fit is explainable/editable, not arbitrary confidence decoration.
> A3.4 Named person qualifies/passes/defers; qualified handoff creates linked Comms preparation once with context and owner.
> A3.5 No external outreach or new data-source purchase/connection in QA. Test repeat intake, incomplete data, conflicting companies and rejected prospects.
> A3.6 Repeatable prep automatically runs in synthetic enabled test policy, not only via a decorative Generate button.

**What was read first**

`docs/architecture-canon.md`, `src/domain/registry.ts`, `src/domain/website.ts`,
`src/domain/website-matching.ts`, `src/domain/scout.ts`, `src/domain/scout-fit.ts`,
`src/domain/confidence.ts`, Round 1 (`agency-journey.ts`) and Round 2
(`preparation-jobs.ts`, `preparation-runner.server.ts`). Website→Scout identity
matching already existed, so this round builds on `matchProspect` rather than
adding a second matcher or a second store.

**Changes**

- `src/domain/enquiry-qualification.ts` (new). Pure contract between Website and
  Scout: `enquiryKey`/`enquiryContext`/`receiveEnquiry` (source, time, consent and
  attribution carried exactly; repeat submission returns `duplicate`; ambiguous
  identity stays `unlinked`; unsupported source kinds are `unavailable`), the
  qualification packet (`PacketFact` with evidence URL and observed date,
  `PacketInference` with what it rests on, named `unknowns`, quoted business need,
  editable `FitRationale` tied to an explicit ICP version), `stripInventedIntent`,
  `packetReadiness`, `QualificationDecision` (qualify/pass/defer by a named person)
  and `commsPreparationFor` (one keyed Comms preparation per enquiry, with owner
  and tiered context).
- `src/lib/enquiry-preparation.server.ts` (new). Trigger side:
  `enquiryPreparationRequest`, `enquiryDeterministicRead` (counts and gaps computed
  in code; their words travel only as wrapped material), `prepareEnquiryOnIntake`
  (runs on intake through the Round 2 runner, returns `null` while the job is off),
  `finalisePacket`.
- `src/domain/enquiry-qualification.test.ts` (12) and
  `src/lib/enquiry-preparation.server.test.ts` (6).

No new table, no new room, no new route, no navigation or styling change, no schema
applied, no outreach, no new data source connected, no Comms acceptance row touched.
QA session `9b329dbe-02ca-40d6-9f54-9ec728c64446` untouched.

**Evidence and build**

- `bunx vitest run` — 3,097 tests across 278 files pass (18 new this round).
- `bunx tsgo --noEmit` — clean. Build observability: `build OK`.
- Evidence kind: **code plus synthetic sandbox execution**. No real model call, no
  persisted database output, no live enquiry, no deployment, no team acceptance.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A3.1 | Enquiry retains source/time/consent and links canonically without duplicate creation on retry | Round 1, existing `matchProspect` | `enquiryContext`, `receiveEnquiry`; tests "keeps source, time and consent", "does not create a second enquiry", "leaves conflicting companies for a person" | PASS-CODE | Agent | Wire into the real Website intake handler when the preparation store lands |
| A3.2 | AI prepares fit rationale, evidence URLs/dates, business need, unknowns, first move against explicit ICP; unsupported sources unavailable | A3.1, Round 2 runner | `QualificationPacket`, `PacketEvidence` (url + observedAt), `enquiryDeterministicRead` ICP block, `SUPPORTED_ENQUIRY_SOURCES`, `packetReadiness` refusing fit without an ICP | PASS-CODE + synthetic | Agent | Real wording quality unproven until an authorised provider call runs |
| A3.3 | Facts, inferences and relevance separated from invented intent/budget; fit explainable and editable | A3.2 | Separate `facts`/`inferences`/`unknowns` arrays, `FitRationale.editedByPerson`, `stripInventedIntent`; tests "drops invented spend and intent", "keeps a spend claim they actually made" | PASS-CODE | Agent | Surface the edit affordance in Scout in a later round |
| A3.4 | Named person qualifies/passes/defers; qualified handoff creates one linked Comms preparation with context and owner | A3.1–A3.3 | `QualificationDecision`, `commsPreparationFor`; tests "opens one Comms preparation", "never opens a second", "opens nothing for a rejected or deferred enquiry", "will not hand off without a named owner" | PASS-CODE | Agent | Handoff record persistence is BLOCKED on the Round 2 SQL proposal |
| A3.5 | No external outreach or new data source in QA; repeat intake, incomplete data, conflicting companies and rejected prospects tested | A3.1–A3.4 | All 18 tests are in-memory and synthetic; no network call, no connector added, no mailbox scope change; the four named cases each have a test | PASS-CODE + synthetic | Agent | — |
| A3.6 | Repeatable prep runs automatically under an enabled synthetic policy, not only via a Generate button | Round 2 A2.5 | `prepareEnquiryOnIntake` called from intake, not from UI; tests "does nothing while the job is off" and "prepares automatically once the workspace enables the job"; idempotency test proves one stored record for two arrivals | PASS-CODE + synthetic | Agent | Arming the trigger on real events stays BLOCKED until the schema is applied and an authorised person enables the job |

**Open and blocked**

- Persisted enquiry preparation and persisted handoff records remain **blocked** on
  the unapplied `20260916130000_preparation_outputs.sql`. Owner: Codex.
- No real provider call, so fit wording quality and usage/cost stay **unverified**.
- No trigger is armed on a real Website event; the job remains off by default.
- Live authenticated verification remains unavailable here. Owner: Codex.
- Round 3 advances no Comms acceptance row and implies no completion.

---

## Round 4 of 10 — Turn conversations into discovery and decisions

**Exact submitted prompt**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 4/10: 4. Turn conversations into discovery and decisions
> Build on current Comms, including recent-email dashboard and existing review gates.
> A4.1 Eligible source events prepare concise brief: goal, known facts, open questions, commitments and next move, each grounded in same-client context.
> A4.2 Distinguish proposed tasks/commitments from confirmed ones; owner accepts actionable handoff without retyping. Inbound/unread is not automatically reply owed.
> A4.3 Discovery intake captures desired outcome, current constraints, stakeholders, budget/timing unknowns, success measure and sources. Raw notes remain accessible.
> A4.4 AI drafts responses under current Voice DNA and actual author, answers all requests, suggests private opportunities appropriately; preserve all original reviewer criteria.
> A4.5 Approved discovery handoff opens linked Roadmap with source references, unanswered questions and owner, exactly once.
> A4.6 Preserve draft save/reload, real thread targeting, sync freshness and failed-read honesty. No actual sends. Do not silently waive open Comms live checks.

**Changes**

- `src/domain/conversation-brief.ts` (new) — grounded brief: goal, known facts, open
  questions, commitments, one next move; same-client grounding enforced and anything
  ungrounded named in `droppedBecause`; proposed vs confirmed commitments;
  `acceptCommitment` carries wording, due date and sources across untouched;
  `replyOwed` treats arrival and unread as not an obligation.
- `src/domain/discovery-intake.ts` (new) — discovery record with desired outcome,
  constraints, stakeholders, named budget/timing unknowns, success measure, sources;
  `rawNotesOf` keeps raw notes reachable; `discoveryReadiness`; `roadmapHandoffFor`
  opens exactly one roadmap from an approved, complete, owned discovery.
- `src/lib/conversation-brief.server.ts` (new) — the conversation job on the Round 2
  shared runner: `briefPreparationRequest` (job `conversation_summary`),
  `briefDeterministicRead` (counts in code, material as quoted data),
  `prepareBriefOnConversation` (null while the job is off), `assemblePreparedBrief`
  (grounding re-checked after the model writes).
- Tests: `src/domain/conversation-brief.test.ts` (14),
  `src/domain/discovery-intake.test.ts` (10),
  `src/lib/conversation-brief.server.test.ts` (6).

No new room, route, navigation entry, styling change, table or migration. No Comms
component, review gate, draft save path, thread targeting or sync code changed. No
send. QA session `9b329dbe-02ca-40d6-9f54-9ec728c64446` untouched.

**Evidence and build**

- `bunx vitest run` — 3,127 tests across 281 files pass (30 new this round).
- `bunx tsgo --noEmit` — clean. Preview build: OK.
- Evidence kind: **code plus synthetic sandbox execution**. No real model call, no
  persisted output, no live conversation, no deployment, no team acceptance.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A4.1 | Eligible source events prepare a concise grounded brief | Round 2 runner | `assembleBrief`, `eligibleSources`, `briefDeterministicRead`; tests "keeps goal, facts, questions and next move that are grounded", "drops an ungrounded line and says so", "refuses a line grounded in another client's material" | PASS-CODE + synthetic | Agent | Wording quality unproven until an authorised provider call runs |
| A4.2 | Proposed vs confirmed; owner accepts without retyping; inbound/unread is not reply owed | A4.1, existing `comms-obligations` | `Commitment.state`, `acceptCommitment`, `replyOwed`; tests "never accepts a commitment that arrives already confirmed", "carries the wording and sources across without retyping", "does not owe a reply just because mail arrived unread", "stays silent rather than guessing when nothing has been reviewed" | PASS-CODE | Agent | Surface accept in the conversation room in a later round |
| A4.3 | Discovery intake captures outcome, constraints, stakeholders, budget/timing unknowns, measure, sources; raw notes accessible | Round 1 contract | `DiscoveryRecord`, `discoveryReadiness`, `rawNotesOf`; tests "asks for the success measure when it is missing", "accepts an unknown budget only when the question is written down", "keeps the raw notes reachable and unchanged" | PASS-CODE | Agent | Persisted discovery records BLOCKED on the Round 2 SQL proposal |
| A4.4 | AI drafts under current Voice DNA and actual author, answers all requests, preserves reviewer criteria | Existing Comms review stack | No change made to Voice DNA resolution, author identity, `comms-obligations`, `comms-review` or reviewer criteria this round; existing suite passes unchanged | NOT-PERFORMED (unchanged existing behaviour) | Codex | Authenticated live review evidence remains open in the Comms closure record; not advanced here |
| A4.5 | Approved discovery opens a linked Roadmap with source refs, unanswered questions and owner, exactly once | A4.3 | `roadmapHandoffFor`; tests "opens one roadmap with sources, open questions and an owner", "opens nothing before a person approves", "opens nothing without an owner", "returns the first roadmap rather than opening a second" | PASS-CODE | Agent | Persisted roadmap opening BLOCKED on the Round 2 SQL proposal |
| A4.6 | Draft save/reload, thread targeting, sync freshness and failed-read honesty preserved; no sends | Existing Comms | No Comms save, thread-parameter, sync or recent-email code touched; full suite green; no send path exercised or added | PASS-CODE | Agent | Live signed-in confirmation remains with Codex; no open Comms live check is waived |

**Open and blocked**

- Persisted briefs, accepted tasks, discovery records and roadmap openings remain
  **blocked** on the unapplied `20260916130000_preparation_outputs.sql`. Owner: Codex.
- No real provider call this round, so brief wording quality and usage/cost stay
  **unverified**; the conversation job remains off by default.
- Live authenticated verification remains unavailable here. Owner: Codex.
- Round 4 advances no Comms acceptance row (C01–C22, T01–T05, P1–P8 unchanged) and
  implies no completion.

---

## Round 5 of 10 — Build roadmaps and proposals that can be delivered

**Exact submitted prompt**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 5/10: 5. Build roadmaps and proposals that can be delivered
> Roadmap owns strategy; Comms owns reviewed expression; reuse approved evidence.
> A5.1 AI prepares Point A→Point B, phased recommendations, options, dependencies and first move with evidence and unknowns.
> A5.2 Human approves destination/priorities; inferred schedules, capacity and budget remain provisional.
> A5.3 Proposal derives from approved roadmap version: scope, exclusions, deliverables, acceptance criteria, assumptions, responsibilities, pricing and next steps.
> A5.4 Deterministic arithmetic; mixed/unknown amounts explicit; estimate and capacity check required before approved dates/prices. No invented availability.
> A5.5 Changes invalidate dependent proposal/review readiness and clearly show what changed without overwriting human edits.
> A5.6 Save/reload one synthetic approved roadmap and linked proposal; verify immutable versions and exact traceability; no client send.

**Changes**

- `src/domain/roadmap-preparation.ts` (new): Point A notes with tier and evidence,
  destination, phases with options and dependencies, first move, named unknowns;
  `provisionalItems`/`provisionalNote` keep schedule, capacity and budget provisional
  until a named person decides; `approveDestination` and `approvePriorities` require a
  named person and known phases; `roadmapStamp` and `freezeRoadmapVersion` produce an
  immutable, deep-cloned, content-stamped version and return the existing version for
  identical content; `roadmapChanges` names what moved between two versions.
- `src/domain/proposal-derivation.ts` (new): `deriveProposal` builds scope, exclusions,
  deliverables, acceptance criteria, assumptions, responsibilities, pricing and next
  steps from exactly one frozen version, each line carrying `fromVersionId` and
  `fromPhaseId`; pricing reuses the existing deterministic `priceProposal`; mixed
  currencies are named and never added; missing amounts are listed as unknown, never
  zero; `quoteReadiness` requires a recorded estimate and a recorded capacity check per
  phase, so availability is never invented; `editLine` marks a human edit;
  `rederiveAgainst` rebuilds derived lines, carries every human edit across untouched and
  returns the change list; `proposalReviewReadiness` withdraws readiness while the
  proposal is behind the current version, the stamp differs, changes are unread, or
  currencies are mixed.
- Tests: `src/domain/roadmap-preparation.test.ts` (8), `src/domain/proposal-derivation.test.ts` (8).
- No Comms code, review gate, save path, auth, schema or send path touched. No route,
  styling or navigation change. No new app, store or approval queue.

**Evidence and build**

- `bunx vitest run` — 3,143 tests across 283 files pass (16 new this round).
- `bunx tsgo --noEmit` — clean.
- Evidence kind: **code plus synthetic sandbox execution**. No real model call, no
  persisted record, no client send, no deployment, no team acceptance.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A5.1 | Point A→B, phases, options, dependencies, first move, evidence, unknowns | Round 1 contract | `PreparedRoadmap`, `PreparedPhase.options`/`dependsOn`, `unknowns`; tests in `roadmap-preparation.test.ts` | PASS-CODE + synthetic | Agent | Wording quality unproven until an authorised provider call runs |
| A5.2 | Human approves destination and priorities; schedule, capacity, budget stay provisional | A5.1 | `approveDestination`, `approvePriorities`, `provisionalNote`; tests "refuses a destination approval with nobody named", "refuses an order that names a phase that is not on the roadmap", "keeps schedules, capacity and budget provisional" | PASS-CODE | Agent | Surface the approval affordance in the Roadmap room in a later round |
| A5.3 | Proposal derives from an approved roadmap version with all eight sections | A5.2 | `deriveProposal`; test "derives every section from exactly one roadmap version" | PASS-CODE | Agent | Persisted proposals BLOCKED on the unapplied Round 2 SQL proposal |
| A5.4 | Deterministic arithmetic; mixed and unknown amounts explicit; estimate plus capacity check before approved dates or prices | A5.3, existing `comms-proposal` | `buildPricing`, `quoteReadiness`; tests "adds up prices deterministically", "names an unknown amount instead of counting it as nothing", "refuses to add up amounts in different currencies", "requires an estimate and a capacity check" | PASS-CODE | Agent | Real estimates and capacity records depend on persistence (Codex) |
| A5.5 | Changes withdraw dependent readiness and show what changed without overwriting human edits | A5.3 | `rederiveAgainst`, `proposalReviewReadiness`, `roadmapChanges`; tests "keeps a human edit when the roadmap moves, and says what changed", "withdraws review readiness while the proposal is behind the roadmap" | PASS-CODE | Agent | Wire the change notice into the Roadmap and Comms rooms in a later round |
| A5.6 | Save/reload one synthetic approved roadmap and linked proposal; immutable versions and exact traceability; no client send | A5.3 | Test "reloads the same version, the same stamp and the same traceability" (serialise/deserialise round trip); test "does not let a later edit change a frozen version" | PASS-CODE + synthetic | Agent | Real database save/reload BLOCKED on the unapplied SQL proposal; no client send performed or enabled |

**Open and blocked**

- Persisted roadmap versions, estimates, capacity checks and derived proposals remain
  **blocked** on the unapplied `20260916130000_preparation_outputs.sql`. Owner: Codex.
  No migration was applied or reapplied this round; no new SQL was proposed.
- No real provider call this round, so prepared roadmap wording quality and usage or
  cost stay **unverified**.
- Live authenticated verification remains unavailable here. Owner: Codex.
- Round 5 advances no Comms acceptance row (C01–C22, T01–T05, P1–P8 unchanged) and
  implies no completion. Queue progress is not a completion claim.

---

## Round 6 of 10 — Close work and onboard with commercial clarity

**Exact submitted prompt**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 6/10: 6. Close work and onboard with commercial clarity
> Clients is account-facing commercial view. Inspect existing finance/contract integrations and reuse authoritative systems, no new accounting platform.
> A6.1 Separate proposed/approved/sent/client-accepted agreement and unpaid/invoiced/paid; AI never marks signed or paid.
> A6.2 Evidence-backed agreement/payment reference or explicitly human-attested state with author/time; external status unavailable cannot look paid.
> A6.3 Onboarding checklist includes confirmed scope, commercial prerequisites, access needs, responsible people, kickoff and first milestone; secure references not credentials in chat.
> A6.4 Approved readiness creates linked Projects workspace exactly once; missing prerequisites visibly block or require authorized documented exception.
> A6.5 Track estimate vs agreed value, cost basis and margin when data exists; unknown effort/cost not zero/profit.
> A6.6 Synthetic accepted/declined/payment-missing/change-scope cases prove truthful handoffs. No financial transaction, contract submission or external invitations.

**Inspection before coding**

- Existing commercial state (`src/domain/commercial.ts`, `client-commercial-form.ts`,
  `proposal-form.ts`) and the existing deterministic money helpers in
  `comms-proposal.ts` were read and left unchanged. No accounting platform, finance
  integration or invoicing client was added; this round records what an authoritative
  system said, or what a named person attested, and nothing else.

**Changes**

- `src/domain/agreement-state.ts` (new): `AgreementStage` proposed / approved / sent /
  client_accepted / declined kept separate from `PaymentStage` unpaid / invoiced / paid /
  unknown; `setAgreementStage` and `setPaymentStage` refuse a non-person actor for every
  stage past preparation, require a named author and a time, and require either a system
  reference or a human attestation before sent, accepted, declined, invoiced or paid;
  `paymentView` renders a failed external read as "Payment status unavailable" with the
  reason, never as paid and never as quietly unpaid; `marginRead` reports variance and
  margin only when the figures exist and names each missing figure instead of treating it
  as nought or as profit.
- `src/domain/onboarding-readiness.ts` (new): fixed checklist of confirmed scope,
  commercial prerequisites, access needs, responsible people, kickoff and first milestone;
  `recordAccessNeed` stores a pointer to where a credential is kept and refuses anything
  shaped like a credential; `commercialPrerequisites` blocks on a client who has not
  accepted, on an unreadable payment status and on nothing invoiced; `onboardingReadiness`
  lists blocking items in plain words and only passes an unmet item on an owner or admin
  exception with a written reason, which it names; `openProjectsWorkspace` opens exactly
  one workspace per client (`clientRef::project`), returns the first one on a repeat, and
  opens nothing while anything blocks.
- Tests: `src/domain/agreement-state.test.ts` (9), `src/domain/onboarding-readiness.test.ts` (13).
- No route, styling, navigation, Comms, auth, schema or send code touched. No new app,
  store, approval queue or accounting platform. No financial transaction, contract
  submission or external invitation exists in this code.

**Evidence and build**

- `bunx vitest run` — 3,165 tests across 285 files pass (22 new this round).
- `bunx tsgo --noEmit` — clean.
- Evidence kind: **code plus synthetic sandbox execution**. No real model call, no
  persisted record, no finance or contract system contacted, no deployment, no team
  acceptance.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A6.1 | Agreement and payment tracked separately; AI never marks signed or paid | Existing `commercial.ts` | `AgreementStage`/`PaymentStage`, `PERSON_ONLY`; tests "keeps the agreement and the money as separate readings", "refuses to let preparation mark an agreement accepted", "refuses to let preparation mark money paid" | PASS-CODE | Agent | Surface both readings in the Clients account view in a later round |
| A6.2 | Reference-backed or human-attested with author and time; unavailable never looks paid | A6.1 | `StateEvidence`, `paymentView`; tests "will not mark sent or accepted without evidence", "accepts a human attestation with an author and a time", "shows an unreadable finance system as unavailable, never as paid", "says where a payment reading came from" | PASS-CODE | Agent | Real finance-system references depend on an authoritative integration, not added here |
| A6.3 | Checklist covers scope, commercials, access, people, kickoff, first milestone; secure references not credentials | Round 1 contract | `CHECKLIST_ORDER`, `recordAccessNeed`; tests "covers scope, commercials, access, people, kickoff and the first milestone", "records where a credential is kept, and refuses the credential itself" | PASS-CODE | Agent | Render the checklist in the client workspace in a later round |
| A6.4 | Approved readiness opens one Projects workspace; missing prerequisites block or need an authorised documented exception | A6.3 | `onboardingReadiness`, `openProjectsWorkspace`; tests "opens exactly one workspace and returns the first one after that", "opens nothing while a prerequisite is in the way", "lets an owner pass an item with a written exception, and names it", "refuses an exception from someone who is not an owner or admin" | PASS-CODE | Agent | Persisted handoff BLOCKED on the unapplied Round 2 SQL proposal |
| A6.5 | Estimate vs agreed value, cost basis and margin when data exists; unknown effort or cost is not zero or profit | Round 5 estimates | `marginRead`; tests "leaves margin unknown rather than counting a missing cost as profit", "works out margin exactly when every figure exists" | PASS-CODE | Agent | Real cost basis depends on an authoritative finance source; none connected |
| A6.6 | Synthetic accepted / declined / payment-missing / scope-change cases prove truthful handoffs; no transaction, submission or invitation | A6.1–A6.5 | Suite "synthetic cases: accepted, declined, payment missing, scope change" (4 tests) | PASS-CODE + synthetic | Agent | Real persisted cases BLOCKED on the SQL proposal; no external action performed or enabled |

**Open and blocked**

- Persisted agreement states, payment readings, checklists and Projects handoffs remain
  **blocked** on the unapplied `20260916130000_preparation_outputs.sql`. Owner: Codex.
  No migration was applied or reapplied this round; no new SQL was proposed.
- No authoritative finance or contract integration exists, so every reference-backed
  state is **unverified against a real system** and stays human-attested by design.
- Live authenticated verification remains unavailable here. Owner: Codex.
- Round 6 advances no Comms acceptance row (C01–C22, T01–T05, P1–P8 unchanged) and
  implies no completion. Queue progress is not a completion claim.

---

## Round 7 of 10 — Deliver with capacity and acceptance evidence

**Exact submitted prompt**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 7/10: 7. Deliver with capacity and acceptance evidence
> Projects owns execution. Prepare work from accepted scope using existing milestones/tasks.
> A7.1 AI decomposes milestone into proposed tasks/tests/dependencies; designated lead accepts owners and dates using recorded availability, no assignment guessing.
> A7.2 Over-allocation/conflicts visible before dates committed; partial capacity data labelled.
> A7.3 Task complete≠milestone accepted≠client outcome achieved. Milestones carry evidence/test results and explicit acceptance decision.
> A7.4 Scope changes propose cost/time impact and route back to commercial decision, never silently expand commitments.
> A7.5 Milestone events prepare Comms status updates automatically in test policy; risks include reason, owner and next action.
> A7.6 Synthetic journey completes one milestone with real persisted evidence and records Ops handoff; retries don't duplicate tasks or updates.

**Dependencies read before changing code**

- `src/domain/project-delivery.ts`, `src/domain/delivery-projection.ts` — existing Projects
  work items, blockers, decisions, files. Reused, not replaced. No new store added.
- `src/domain/preparation-jobs.ts` — the `milestone_status_draft` job already exists from
  Round 2, off by default, writes only `preparation_output`. Reused as-is; no new job added.
- `src/lib/preparation-runner.server.ts`, `src/lib/conversation-brief.server.ts` — the
  trigger pattern the status job follows.
- Rounds 5 and 6 output — the frozen roadmap version, derived proposal and accepted scope
  this round decomposes from.

**Changes**

- `src/domain/milestone-delivery.ts` (new): `decomposeMilestone` (proposed tasks, one check
  per scope line, dependency edges, no owner and no date); `acceptTask` (named lead, named
  owner, refuses a date with no recorded availability for that person in that week);
  `capacityRead` (committed against available per person per week, conflicts named, missing
  availability labelled a partial reading rather than assumed free); `milestoneReading`
  (tasks finished, ready for acceptance, accepted, client outcome confirmed, kept as four
  separate readings); `decideMilestone` (explicit named decision, refused while checks are
  missing or failing or evidence is absent); `scopeChangeImpact` (time and cost impact,
  unknown stated as unknown, routed to a commercial decision, commitments unchanged);
  `recordOpsHandoff` (one per milestone, retry returns the first); `recordRisk` (refuses a
  risk without a reason, an owner and a next action).
- `src/lib/milestone-status.server.ts` (new): trigger side of `milestone_status_draft`.
  Revision moves only when the milestone actually moves; counts and state checks computed
  in code; evidence and risks travel as quoted material; a failed check sets
  `needsDecisionBecause`; a milestone with nothing recorded refuses to prepare. Returns
  null while the job is off, which is every workspace by default.
- Tests: `src/domain/milestone-delivery.test.ts` (16), `src/lib/milestone-status.server.test.ts` (7).

**Evidence and build**

- `bunx vitest run` — 3,188 tests across 287 files pass (23 new this round).
- `bunx tsgo --noEmit` — clean.
- Evidence kind: **code plus synthetic sandbox execution**. No real model call, no persisted
  record, no deployment, no team acceptance, no external action.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A7.1 | Milestone decomposed into proposed tasks, checks and dependencies; lead accepts owners and dates from recorded availability, no guessing | Round 6 accepted scope | `decomposeMilestone`, `acceptTask`; tests "proposes tasks with checks and dependencies, owning nothing", "refuses a date with no recorded availability rather than guessing", "refuses an unnamed lead", "records the lead, the owner and the date when availability exists" | PASS-CODE | Agent | Surface the accept affordance in the Projects room in a later round |
| A7.2 | Over-allocation and conflicts visible before dates are committed; partial capacity labelled | A7.1 | `capacityRead`; tests "shows over-allocation before dates are committed", "labels a reading as partial when availability is missing" | PASS-CODE | Agent | Real availability data depends on a recorded source; fixtures only here |
| A7.3 | Task complete ≠ milestone accepted ≠ client outcome; milestones carry evidence, test results and an explicit decision | A7.1 | `milestoneReading`, `decideMilestone`; tests "keeps finished tasks, acceptance and the client outcome apart", "refuses acceptance while a check has not passed", "refuses acceptance with no evidence recorded", "records who accepted it and when", "refuses a decision with nobody's name on it" | PASS-CODE | Agent | Render the three readings distinctly in the Projects room |
| A7.4 | Scope changes propose cost and time impact and route to a commercial decision, never expand commitments silently | Round 6 commercial states | `scopeChangeImpact`; tests "routes to a commercial decision and leaves the commitment alone", "says unknown rather than nought when nothing has been estimated" | PASS-CODE | Agent | Wire the handoff key into the Clients commercial view in a later round |
| A7.5 | Milestone events prepare Comms status updates under test policy; risks carry reason, owner and next action | Round 2 job spec | `prepareStatusOnMilestoneChange` (off by default), `statusDeterministicRead`, `recordRisk`; tests "prepares nothing while the job is off", "counts in code, keeps the three readings apart and quotes material as data", "asks for a person when a check did not pass", "refuses a risk with no reason, owner or next action" | PASS-CODE + synthetic | Agent | The job stays disabled in every workspace until an authorised person enables it; no send exists |
| A7.6 | Synthetic journey completes one milestone with persisted evidence and records an Ops handoff; retries do not duplicate | A7.1–A7.5, Round 2 SQL | Suite "synthetic journey: one milestone, retried" — one stored record across two events, one Ops handoff across two attempts | PARTIAL-BLOCKED | Agent / Codex | Idempotency and handoff proven in the synthetic sandbox; **real persisted evidence remains BLOCKED** on the unapplied `20260916130000_preparation_outputs.sql` |

**Open and blocked**

- Persisted tasks, capacity readings, acceptance decisions and Ops handoffs remain
  **blocked** on the unapplied `20260916130000_preparation_outputs.sql`. Owner: Codex.
  No migration was applied or reapplied this round; no new SQL was proposed.
- No real model has written a status update; wording quality is **unproven**.
- Live authenticated verification remains unavailable here. Owner: Codex.
- Round 7 advances no Comms acceptance row (C01–C22, T01–T05, P1–P8 unchanged), touches no
  Comms code, and implies no completion. Queue progress is not a completion claim.

---

## Round 8 of 10 — Support, retain and create relevant demand

**Exact submitted prompt**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 8/10: 8. Support, retain and create relevant demand
> Ops owns technical care; Clients owns account; Roadmap future strategy; Studio content; Website attribution.
> A8.1 Accepted delivery creates linked care checklist with support boundaries, owner, monitoring references and review date; unknown health stays unknown.
> A8.2 Existing permitted health events generate deduplicated triage/work suggestions; no autonomous destructive remediation.
> A8.3 Outcome review compares confirmed baseline/target/observed result; attributed value not invented or confused with output volume.
> A8.4 AI proposes evidence-backed renewal/expansion opportunity with timing; complaint/service recovery does not trigger automatic upsell.
> A8.5 Studio prepares content brief from deliberately approved lessons/results, no cross-client details or case-study publication permission assumed. Content references source/target audience/goal; approved publication remains separate.
> A8.6 Website/intake attribution links subsequent enquiry when evidence exists; no invented causal revenue attribution. Run synthetic care→review→next-roadmap loop.

**Dependencies**

- Round 7 milestone acceptance (`src/domain/milestone-delivery.ts`) supplies the accepted
  delivery that opens care.
- Existing shared vocabulary reused, not duplicated: `src/domain/outcomes.ts`
  (`TruthClass`, `MetricClass`, `metricClassOf`, `FACTORY_METRICS`) and the existing Ops
  health vocabulary in `src/domain/ops.ts`. No new CRM, approval queue, business-data store
  or top-level app was introduced.

**Changes**

- `src/domain/client-care.ts` (new): `openCarePlan` (one care plan per accepted milestone,
  key `${clientRef}::care::${milestoneId}`, retry returns the first, refused before
  acceptance), the four fixed checklist items (support boundaries, owner, monitoring
  references, review date) and `careGaps`; `readCareHealth` (health is read from what
  monitoring actually said, no reference or no reading stays `unknown`, all-unreadable stays
  `unknown` with the sources named, mixed reads take the worst state and are labelled a
  partial reading); `HealthEvent` / `triageFromEvents` (grouped by signature so repeats make
  one suggestion, other clients' events excluded, every suggestion `needsPersonToAct`) and
  `suggestionIsPermitted` (refuses any wording that would delete, restart, reset, revoke,
  rotate, truncate, wipe or restore); `reviewOutcome` (baseline/target/observed each carry a
  truth tier and evidence, a missing figure is named as unknown rather than counted as
  nought, an unconfirmed baseline or result makes the comparison provisional, and attributed
  value is refused for an output-class metric, with no evidence, or with an unconfirmed
  result); `proposeOpportunity` (evidence-backed, timed against a recorded renewal date,
  `needsPersonToRaise`, refused outright while a complaint is open or service recovery is
  under way).
- `src/domain/demand-attribution.ts` (new): `prepareContentBrief` (uses only lessons
  approved for content use for this client, excludes another client's material and says so,
  requires audience and goal, keeps naming permission separate from content permission,
  `publicationApproved` is always `false`, source references carried per point, and no value
  is claimed where none was attributed); `attributeEnquiry` (links an enquiry to content only
  where the enquiry itself carried a known marker, states plainly that it does not claim
  revenue causation, refuses timing-only links); `openNextRoadmap` (one handoff per reviewed
  measure, named owner required, refused while the result cannot be told, retry returns the
  first).
- Tests: `src/domain/client-care.test.ts` (16), `src/domain/demand-attribution.test.ts` (10,
  including the synthetic care → review → next roadmap loop).
- No route, styling, Comms, auth, schema or send code was touched.

**Evidence and build**

- `bunx vitest run` — full suite pass (26 new this round).
- `bunx tsgo --noEmit` — clean. Preview build — clean.
- Evidence kind: **code plus synthetic sandbox execution**. No real model call, no persisted
  record, no publication, no deployment, no team acceptance, no external action.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A8.1 | Accepted delivery opens a linked care checklist with boundaries, owner, monitoring references and review date; unknown health stays unknown | Round 7 acceptance | `openCarePlan`, `careGaps`, `readCareHealth`; tests "does not open before the milestone is accepted", "opens once and returns the first plan on retry", "carries the four checklist items and names the gaps", "starts unknown, not healthy", "stays unknown with no monitoring reference", "stays unknown when every source failed to read", "takes the worst state and flags a partial reading" | PASS-CODE | Agent | Surface the care checklist in the Ops room in a later round |
| A8.2 | Permitted health events produce deduplicated triage suggestions; no autonomous destructive remediation | A8.1, existing Ops health events | `triageFromEvents`, `suggestionIsPermitted`; tests "groups repeats into one suggestion and keeps other clients out", "refuses anything that would destroy or disrupt" | PASS-CODE | Agent | Bind to the real Ops event source once it is read-scoped in a later round |
| A8.3 | Outcome review compares confirmed baseline, target and observed; attributed value never invented nor confused with output volume | `src/domain/outcomes.ts` | `reviewOutcome`; tests "names a missing figure instead of counting it as nought", "compares baseline, target and observed when all are recorded", "refuses to attribute value to a measure of output volume", "refuses attributed value with no evidence" | PASS-CODE | Agent | Real baselines depend on recorded client measures; fixtures only here |
| A8.4 | Evidence-backed renewal or expansion proposal with timing; complaint or service recovery blocks automatic upsell | A8.3 | `proposeOpportunity`; tests "proposes from confirmed evidence with timing", "proposes nothing while a complaint is open", "proposes nothing during service recovery" | PASS-CODE | Agent | Account mood must come from a recorded account state, not inference, when wired to Clients |
| A8.5 | Studio brief from deliberately approved lessons and results; no cross-client detail, no assumed publication permission; source, audience and goal recorded | A8.3 | `prepareContentBrief`; tests "refuses a lesson that was never approved for content", "leaves another client's lesson out", "needs an audience and a goal", "never assumes naming or publication permission" | PASS-CODE | Agent | Publication approval stays a separate human decision in Studio; nothing here publishes |
| A8.6 | Website and intake attribution links a later enquiry where evidence exists, with no invented causal revenue; synthetic care → review → next roadmap loop runs | A8.1, A8.3 | `attributeEnquiry`, `openNextRoadmap`; tests "links only when the enquiry carried evidence", "claims nothing from timing alone", "opens once with an owner and returns the first on retry", "refuses without a named owner", "refuses when the result cannot be told", suite "synthetic care to review to next roadmap loop" | PASS-CODE + synthetic | Agent / Codex | Loop proven in the synthetic sandbox; **real persisted evidence remains BLOCKED** on the unapplied `20260916130000_preparation_outputs.sql` |

**Open and blocked**

- Persisted care plans, triage suggestions, reviews, opportunities, briefs and attribution
  links remain **blocked** on the unapplied `20260916130000_preparation_outputs.sql`.
  Owner: Codex. No migration was applied or reapplied this round; no new SQL was proposed.
- No real model has written a brief or an opportunity; wording quality is **unproven**.
- Live authenticated verification remains unavailable here. Owner: Codex.
- Round 8 advances no Comms acceptance row (C01–C22, T01–T05, P1–P8 unchanged), touches no
  Comms code, and implies no completion. Queue progress is not a completion claim.

---

## Round 9 of 10 — Give the eight-person team a simple daily workspace

**Exact submitted prompt**

> TRUST TAI AI AGENCY JOURNEY BUILD. Tai authorizes this ordered queue. Goal: eight-person team can source, diagnose, propose, onboard, deliver, support and grow clients using AI for repeatable preparation. Read current architecture canon, app registry, prior round output and existing services before changing code. Preserve unfinished Comms acceptance work and security fixes; do not overwrite concurrent work. No new parallel CRM, approval queue or business-data store. Apps own state; core identity; event history; Steward interpretation; Pulse visibility; Conductor routes actions. Preserve white cards/pale-blue OS styling, plain words, existing routes and client links. Do not introduce a new top-level app without demonstrated need.
>
> Product interpretation of Hit Makers: familiar surprise and MAYA. Familiar inbox/list/client workspace, consistent verbs and repeatable layout; intelligence prepares useful next work with evidence. Progressive disclosure, primary next action, clear owner, undo/correction where feasible. No agent jargon or orchestration diagrams in daily user flows. This is an application of the book, not a guaranteed popularity formula.
>
> Autonomy: implement and verify useful low-risk internal preparation (summaries, research packets, draft plans, reminders/tasks) via scoped server-side workers using existing services. Human authority governs commitments, pricing, scope/date approval and external action. Nothing in this build queue authorizes actual outreach, publication, payment, production deployment, live mailbox scope expansion or production schedule activation. Configure new automation disabled or preview-only until its policy/configuration is explicitly enabled by an authorized user; synthetic sandbox execution allowed. No real team assignment guesses, credentials or customer data in fixtures. SQL proposals to Codex; do not apply or reapply migrations. Never bypass auth for live evidence.
>
> Each round must write exact submitted prompt and numbered acceptance rows to docs/agency-journey-build-progress.md, with dependencies, changes, evidence/build, pass/blocked, owner and next step. Preserve C01-C22/T01-T05/P1-P8. Code, synthetic model evaluation, real persisted execution, production deployment and team acceptance are distinct. Do independent useful work when dependencies blocked, but do not mark dependent checks passed. No 100% from queue completion.
>
> QUEUED ROUND 9/10: 9. Give the eight-person team a simple daily workspace
> Use Home as personal work entry, client workspace as continuity, Conductor as optional command surface; no mandatory tour through every app.
> A9.1 Home shows My next actions, AI-prepared work and Decisions needed, each with reason/owner/one clear next action. Roles configured from real existing access, no invented staff.
> A9.2 Familiar consistent verbs Open/Review/Edit/Approve/Assign/Done; AI details collapsed; white cards and legible density. Empty states help start task.
> A9.3 Steward links recommendations to evidence and current owner; Pulse shows pipeline/cycle time/delivery/collections/margin only where measured, freshness and denominators explicit.
> A9.4 Conductor answers with source links and prepares bounded actions through owning services; no direct cross-domain writes or prompt-granted authority.
> A9.5 Approvals route only within existing verified policy. Team leads may handle already-authorized routine decisions; no automatic expansion of permissions or Comms owner/admin rule. Prepare any delegation policy for later explicit admin enablement.
> A9.6 On1440/768/375 and keyboard, user can find next task and act without knowing architecture. Progressive disclosure and same layout repeated across work types.
> A9.7 Prepare 5-minute guided scenario and usability scorecard. Target >=4/5 representative teammates identify next task within30seconds and complete core handoff without coaching; real team evidence required, AI cannot self-award this.

**Dependencies**

- Existing rooms and routes (`PRIMARY_NAVIGATION`, `src/routes/modules.*`), existing
  `organization_memberships` role model, Rounds 1–8 preparation output. No new top-level app,
  CRM, approval queue or business-data store was introduced, and no existing route, styling
  token or Comms code was changed.

**Changes**

- `src/domain/daily-workspace.ts` (new): `peopleFromMemberships` (colleagues come only from
  active memberships in this organization, so no staff can be invented and a lapsed member is
  not a person); `WORKSPACE_VERBS` fixed to Open, Review, Edit, Approve, Assign, Done;
  `WORK_GROUP_ORDER` / `WORK_GROUP_LABEL` / `WORK_GROUP_EMPTY_STATE` (the same three lists in
  the same order every day, each empty state naming a way to start); `admitWorkItem` and
  `buildWorkspace` (a row is refused unless it carries a reason, an active named owner whose
  name matches the membership, a known verb and a route into the owning room; dated work sorts
  ahead of undated, then newest movement first; a colleague's action is not shown as mine,
  while prepared work is visible with its owner named); `preparedDetail` carried separately so
  preparation stays collapsed; `stewardDisplay` (a recommendation without evidence, or without
  a current owner, is not shown); `MeasureReading` / `measureDisplay` (an unmeasured figure is
  never rendered as nought, a share with no base is withheld, and every shown figure carries
  its base and when it was measured, marked out of date past the freshness window);
  `conductorReply` (no sources means no answer; a prepared action outside the asking person's
  existing rooms is dropped; every prepared action is handed to its owning room and marked
  `needsPersonToCarryOut`); `routeApproval` (routes only to roles an existing recorded policy
  already permits, and nowhere at all without one); `prepareDelegationPolicy` (always
  `enabled: false` for an admin to consider later, and refuses outright to prepare any
  delegation of a Comms approval).
- `docs/agency-journey-daily-workspace.md` (new): the five minute guided scenario script and
  the U1–U10 usability scorecard, with the explicit rule that only the person running the
  session may record a result.
- Tests: `src/domain/daily-workspace.test.ts` (21).

**Evidence and build**

- `bunx vitest run` — full suite pass (21 new this round).
- `bunx tsgo --noEmit` — clean. Preview build — clean.
- Evidence kind: **code**. No UI was changed this round, no real model call, no persisted
  record, no deployment, no team acceptance, no external action.

**Acceptance rows**

| Row | Criterion | Dependencies | Evidence | Result | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| A9.1 | Home shows My next actions, prepared work and Decisions needed, each with reason, owner and one next action; roles from real access, no invented staff | Existing memberships | `peopleFromMemberships`, `admitWorkItem`, `buildWorkspace`; tests "comes only from active memberships in this workspace", "refuses an item with no reason", "refuses an owner who is not an active member", "refuses an item that opens nowhere", "shows another person's actions to them, not to me", "shows prepared work even when somebody else owns it" | PASS-CODE | Agent | Render the three lists on Home in a later round; rules are code-only today |
| A9.2 | Familiar verbs, collapsed preparation detail, white cards and legible density, helpful empty states | Existing styling tokens | `WORKSPACE_VERBS`, `WORK_GROUP_EMPTY_STATE`, separate `preparedDetail`; tests "uses only the familiar verbs", "keeps the same three lists in the same order" | PARTIAL-BLOCKED | Agent | Vocabulary, ordering and empty-state copy are fixed in code; **the card rendering itself is not built this round**, so the visual half is not claimed |
| A9.3 | Steward ties recommendations to evidence and current owner; measures shown only where measured, with freshness and denominators | Rounds 5–8 measures | `stewardDisplay`, `measureDisplay`; tests "does not show a recommendation with no evidence", "does not show a recommendation with no current owner", "shows evidence and the current owner together", "does not show a figure that was never measured", "does not show a share with no base", "shows the base and the freshness" | PASS-CODE | Agent | Real pipeline, cycle time, delivery, collections and margin readings depend on persisted data; none are wired |
| A9.4 | Conductor answers with sources and prepares bounded actions through owning services; no cross-domain writes, no prompt-granted authority | Existing rooms | `conductorReply`; tests "gives no answer without a source", "hands prepared work to the owning room and keeps people in charge" | PASS-CODE | Agent | Bind to the live Conductor surface in a later round |
| A9.5 | Approvals route only within existing verified policy; leads handle already-authorized routine decisions; no permission expansion; delegation prepared for later admin enablement | Existing approval policy | `routeApproval`, `prepareDelegationPolicy`; tests "routes nowhere without a recorded policy", "routes only to roles already permitted", "recognises an existing routine allowance for leads", "prepares a delegation that stays switched off", "never prepares a delegation of a Comms approval" | PASS-CODE | Agent / Admin | Any delegation stays disabled until an authorised admin enables it explicitly; the Comms owner and admin rule is untouched |
| A9.6 | At 1440, 768 and 375, and by keyboard, a person finds the next task and acts without knowing the architecture | A9.1, A9.2 | None — no screen was built or measured this round | BLOCKED | Agent | Depends on A9.2's rendering; must be verified on a real signed-in screen, not asserted in code |
| A9.7 | Five minute guided scenario and usability scorecard; at least 4 of 5 teammates find the next task within 30 seconds and complete the core handoff unaided | A9.6 | `docs/agency-journey-daily-workspace.md` — script and U1–U10 scorecard prepared | AWAITING-TEAM | Tai / the team | **Preparation only.** The result requires real teammates in front of a real screen; it cannot be self-awarded and is not claimed here |

**Open and blocked**

- The Home rendering itself is **not built**: A9.2 is partial and A9.6 is blocked on it.
- Persisted work items, measures and approval policy rows remain **blocked** on the unapplied
  `20260916130000_preparation_outputs.sql`. Owner: Codex. No migration was applied or
  reapplied this round; no new SQL was proposed.
- Live authenticated verification remains unavailable here. Owner: Codex.
- A9.7 is **awaiting real team evidence** and is not a pass.
- Round 9 advances no Comms acceptance row (C01–C22, T01–T05, P1–P8 unchanged), touches no
  Comms code, and implies no completion. Queue progress is not a completion claim.
