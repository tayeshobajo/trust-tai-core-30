# Agency operational readiness

One record per round of the correction queue. Each round keeps the exact prompt
that was submitted, numbered acceptance rows, the files that changed, the trace
from route to service to record, the build it was checked on, the evidence
level, the owner and the next action.

Evidence levels, kept apart on purpose and never rolled into one number:

| Level | Means |
| --- | --- |
| CODE | The rule exists in code and is unit tested. |
| IMPLEMENTED-UNCONNECTED | Written and tested, but nothing real calls it yet. Never a functional pass. |
| SYNTHETIC | Executed end to end against invented material, in memory. |
| SQL-UNVERIFIED | SQL written and reviewed by eye. Never executed anywhere. |
| PERSISTED | Written to and read back from the real database. |
| LIVE | Observed on a real signed-in screen. |
| TEAM | A person accepted it. Never self-awarded. |

Baseline reviewed before editing: commit `16e4f83`. Pinned build for this
round: `16e4f83` plus the changes listed below, `bunx tsgo --noEmit` clean and
`bun run build` OK.

---

## Round R1 of 5: make preparation execution safe and connectable

### Exact prompt submitted

> TRUST TAI AI AGENCY OPERATIONAL READINESS. Tai authorizes this agency
> operational-readiness correction queue. Review baseline commit 16e4f83 and
> latest changes before editing; preserve concurrent Comms work and all C/T/P/A
> criteria. Goal: eight people can move a client through real work with clear
> outcomes, owners, next actions and visible exceptions. Continue existing apps
> and owning services, white cards/pale blue, no parallel CRM or approval
> system. Build working routes/adapters/event handlers, not only standalone
> helpers and synthetic tests. Preserve exact prompt and numbered acceptance
> criteria in docs/agency-operational-readiness.md, with changed files,
> route-to-service-to-record trace, pinned build, evidence level, owner and next
> action. Unwired code is IMPLEMENTED-UNCONNECTED, never functional pass.
> Existing required migrations need review; propose revised SQL, do not apply
> production schema. No publish, real outbound message, payment, mailbox scope
> expansion or production trigger activation. Implement independent work despite
> blocked dependencies. Do not invent team acceptance or claim100%.
>
> ROUND R1/5: Make preparation execution safe and connectable.
> Codex inspected preparation-runner.server.ts: existing result returned before
> verifyAccess; store.load/save is not atomic claim; counts are read before
> execution; currentInputRevision and policy passed in once; timeout timer not
> cleaned on success; SQL freezes finished_at/model_use while recovery reuses
> row. Only sandboxStore implements PreparationStore. These are code findings,
> not observed exploits.
> R1.1 Check active workspace and subject access before loading/returning any
> cached output or writing refusal; unauthorized attempts cannot mutate another
> person's run.
> R1.2 Implement real server-only database adapter plus atomic scoped claim with
> bounded lease/recovery, attempt identity and quota reservation; simultaneous
> duplicate events invoke model at most once per claimed attempt. Concurrent
> distinct jobs cannot overrun workspace limit. Do not assume unique insert alone
> handles retries.
> R1.3 Reload policy/stop/access/current source revision at appropriate claim and
> completion boundaries; changed inputs never become current prepared work; no
> endless running row after worker crash. Bounded retry reconciles unknown model
> outcome instead of blind retry.
> R1.4 Align SQL lifecycle with retries: preserve attempt/provenance history while
> permitting permitted recovery; freeze request identity incl requester and output
> content once finalized, owner uses verified membership ID not label alone. Check
> same-workspace subject binding. Explicitly test failed-run→retry→success and
> immutable finished evidence. Revise proposed SQL with minimal grants/RLS and no
> production application.
> R1.5 Clean timeout/abort listeners on all outcomes; persist provider/model/
> instructions version or content hash/input revision and honest usage;
> receipt-save failure must not claim persisted success.
> R1.6 Boundary tests cover cached access revocation, wrong workspace,
> concurrency, quotas, crash recovery, failed saves, mid-run revision/policy
> changes, retry vs SQL constraints. Run database integration tests on disposable
> local/test DB if available; otherwise mark SQL execution unverified. Map
> remaining dependency gaps precisely.

### Changed files

| File | What it is now |
| --- | --- |
| `src/domain/preparation-claim.ts` (new) | The pure claim rule: lease, recovery, attempt bound. No clock, no storage. |
| `src/domain/preparation-claim.test.ts` (new) | 9 tests over that rule. |
| `src/domain/preparation-jobs.ts` | Output record gains `attemptId`, `leaseUntil`, `persisted`, `ownerMembershipId`; `ModelUse` gains `instructionsHash` and `inputRevision`. |
| `src/lib/preparation-runner.server.ts` | Reordered and hardened: access first, atomic claim, limits twice, finish-boundary rechecks, deadline cleanup, honest receipts. |
| `src/lib/preparation-store.server.ts` (new) | The real server-only adapter over `preparation_outputs` and `preparation_attempts`. |
| `src/lib/preparation-policy.server.ts` (new) | Reads `preparation_policy`. Absent means everything off; unreadable is a refusal, never an empty policy. |
| `src/lib/preparation-subjects.server.ts` (new) | Registry of per-job subject readers. Empty by design; a job with no reader refuses. |
| `src/routes/api/public/preparation.run.ts` (new) | The route an event handler or a person calls. Bearer proved, policy read, real store used. |
| `src/data/fixtures/preparation-sandbox.ts` | Sandbox store now implements the same claim rule as the adapter. |
| `src/lib/preparation-boundaries.server.test.ts` (new) | 13 boundary tests: revoked access, wrong workspace, concurrency, quotas, crash recovery, failed saves, mid-run changes. |
| `src/lib/preparation-runner.server.test.ts`, `src/lib/enquiry-preparation.server.test.ts` | Updated to the new store contract and the throwing access refusal. |
| `docs/migrations/proposed/20260916170000_preparation_outputs_r1.sql` (new) | Revised proposal. Supersedes the unapplied `20260916130000` draft. |

### Route to service to record

```text
POST /api/public/preparation/run          src/routes/api/public/preparation.run.ts
  -> bearer token required                 (no token, no run, 401)
  -> subjectReader(jobId)                  src/lib/preparation-subjects.server.ts
       (no reader registered yet -> 501, nothing written)
  -> loadPreparationPolicy()               src/lib/preparation-policy.server.ts
       -> table preparation_policy         (absent row = everything off)
  -> runPreparation()                      src/lib/preparation-runner.server.ts
       -> verifyAccess / verifySubject     (refusal throws, writes nothing)
       -> preparationStore().claim()       src/lib/preparation-store.server.ts
            -> table preparation_outputs   (insert, or compare-and-swap)
            -> table preparation_attempts  (one row per attempt, append only)
       -> runtimeModelCaller()             src/lib/intelligence-runtime.server.ts
       -> preparationStore().complete()    -> table preparation_outputs (by attempt_id)
```

### Acceptance rows

| # | Criterion | Result | Evidence level | Evidence | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| R1.1 | Access and subject checked before any cached output is read, returned or refused; unauthorised attempts mutate nothing | PASS | CODE | `runPreparation` proves access and subject binding before `store.load`. Tests: cached answer not returned after revocation and `load` never called; wrong-workspace subject leaves the store empty; a load scoped to another workspace returns null. | Lovable | None |
| R1.2a | Real server-only database adapter exists | PASS (unwired to real subjects) | IMPLEMENTED-UNCONNECTED | `src/lib/preparation-store.server.ts`, service credentials only, organization filter on every statement. Cannot be exercised: its tables are not in the database. | Codex (SQL), Lovable | Apply the revised SQL, then run a persisted check |
| R1.2b | Atomic scoped claim with bounded lease, recovery and attempt identity | PASS | CODE + SYNTHETIC | `claimDecision` plus insert-or-compare-and-swap in the adapter; sandbox implements the same rule. Two simultaneous identical events: model called once, one record, the loser told it is running. | Lovable | Confirm the swap against a real database |
| R1.2c | Concurrent distinct jobs cannot overrun the workspace limit | PASS | CODE | Limits are read before the claim and again after it; a run that only went over after claiming is stopped before the model is called. | Lovable | None |
| R1.3a | Policy, stop switch, access and subject revision re-read at the finish | PASS | CODE | Three tests: revision moved mid-run, stop switch flipped mid-run, access ended mid-run. None becomes current prepared work. | Lovable | None |
| R1.3b | No endless running row after a worker crash | PASS | CODE | Bounded lease; within it another attempt is refused, past it the work is picked up as attempt 2. | Lovable | None |
| R1.3c | An unknown model outcome is reconciled, never blindly retried | PASS | CODE | Timeout records `uncertain`; `claimDecision` refuses to claim it and `retryDecision` refuses to retry it. | Lovable | None |
| R1.4a | SQL lifecycle allows permitted recovery while preserving attempt history | PASS | SQL-UNVERIFIED | `preparation_attempts` is append only; the output guard reopens a finished row only for a new attempt id with a fresh lease and a higher attempt number. | Codex | Review and apply |
| R1.4b | Request identity, including requester, frozen; finished evidence immutable outside a new attempt | PASS | SQL-UNVERIFIED | `preparation_outputs_guard`. | Codex | Review and apply |
| R1.4c | Owner recorded as a verified membership id, not a label alone | PASS | SQL-UNVERIFIED + CODE | `owner_membership_id` with a same-workspace check in `preparation_outputs_binding`; `ownerMembershipId` carried through the read and the adapter. No room supplies it yet. | Lovable | Rooms to supply the membership id in their subject readers |
| R1.4d | Same-workspace subject binding checked | PARTIAL | CODE + SQL-UNVERIFIED | Code refuses through `verifySubject`; SQL binds requester and owner to the workspace. The subject itself cannot be bound in SQL until each room names its subject table. | Lovable | Bind per-room subject tables when the readers land |
| R1.4e | failed run → retry → success tested explicitly | PASS | CODE | Crash recovery test runs attempt 1 to a dead end and attempt 2 to prepared, attempt count 2, one record. | Lovable | Repeat against a real database once applied |
| R1.5a | Timeout and abort listeners cleaned on every outcome | PASS | CODE | `callWithDeadline` clears the timer and removes the abort listener in `finally`. | Lovable | None |
| R1.5b | Provider, model, instructions hash and input revision persisted; usage honest | PASS | CODE | `modelUse` carries a SHA-256 of the exact instructions and the revision; an unreported token count stays absent rather than becoming zero. | Lovable | None |
| R1.5c | A failed save never claims persisted success | PASS | CODE | `settle` returns `persisted: false` and says the record was not saved. | Lovable | None |
| R1.6a | Boundary tests for revocation, wrong workspace, concurrency, quotas, crash recovery, failed saves, mid-run changes | PASS | CODE | `src/lib/preparation-boundaries.server.test.ts`, 13 tests. | Lovable | None |
| R1.6b | Database integration tests on a disposable database | NOT PERFORMED | SQL-UNVERIFIED | No disposable Postgres is available in this environment, and the production schema must not be touched. No SQL in this round has been executed anywhere. | Codex | Apply the revised SQL on a review database and run a persisted check |
| R1.6c | Remaining dependency gaps mapped | PASS | DOC | See below. | Lovable | Carry into R2 |
| R1.7 | Nothing published, sent, paid, widened or switched on | PASS | CODE | No send, publish, payment or schedule code touched. Every job still ships off; the policy default is an empty enabled list. | Lovable | None |

### Dependency gaps, precisely

1. **Subject readers.** `src/lib/preparation-subjects.server.ts` has no entries.
   Until a room registers one, the route answers 501 and prepares nothing. This
   is the single thing between the route and a real prepared record. Owner:
   Lovable, next round.
2. **Schema.** `preparation_outputs`, `preparation_attempts` and
   `preparation_policy` do not exist in `okydosoacqdnursmmenf`. The adapter and
   the policy reader both refuse honestly when they are missing. Owner: Codex.
3. **Model provenance.** No real model has run through this path, so reported
   usage and cost are still unobserved. Owner: Lovable, once a reader and the
   schema exist.
4. **Live evidence.** No signed-in session is available here, so nothing in
   this round is LIVE. Owner: Codex.
5. **Team acceptance.** Not claimed, not claimable here.

### Preserved

Comms work, and the C01 to C22, T01 to T05, P1 to P8 and A criteria records,
are untouched by this round. No Comms file was edited. Nothing previously
blocked has been advanced or waived.

---

## Round R2 of 5: wire the three repeatable jobs into the application

### Exact prompt submitted

> TRUST TAI AI AGENCY OPERATIONAL READINESS. Tai authorizes this agency
> operational-readiness correction queue. Review baseline commit 16e4f83 and
> latest changes before editing; preserve concurrent Comms work and all C/T/P/A
> criteria. Goal: eight people can move a client through real work with clear
> outcomes, owners, next actions and visible exceptions. Continue existing apps
> and owning services, white cards/pale blue, no parallel CRM or approval
> system. Build working routes/adapters/event handlers, not only standalone
> helpers and synthetic tests. Preserve exact prompt and numbered acceptance
> criteria in docs/agency-operational-readiness.md, with changed files,
> route-to-service-to-record trace, pinned build, evidence level, owner and next
> action. Unwired code is IMPLEMENTED-UNCONNECTED, never functional pass.
> Existing required migrations need review; propose revised SQL, do not apply
> production schema. No publish, real outbound message, payment, mailbox scope
> expansion or production trigger activation. Implement independent work despite
> blocked dependencies. Do not invent team acceptance or claim100%.
>
> ROUND R2/5: Wire the three repeatable jobs into the existing application.
> R2.1 Trace actual enquiry-created, new conversation-message, milestone-changed
> handlers through scoped server jobs to real persistence. No production callers
> currently found for new wrappers. Add actual authenticated event entry points/
> adapters; derive actor/org/source/owner from trusted records, never browser
> policy or guessed identity.
> R2.2 From signed-in preview, creating a clearly synthetic enquiry under test
> policy automatically prepares one qualification packet. Same for conversation
> brief and milestone status draft. No manual calling isolated helper accepted as
> event evidence.
> R2.3 Each output reaches its owning Scout/Comms/Projects room, opens original
> source, shows owner, timestamp, prepared vs accepted, and survives reload;
> accepting uses existing authority and creates/handoffs once.
> R2.4 Keep production jobs disabled. Provide scoped preview/synthetic execution
> that cannot enable production or contact customers; actual model only via
> existing approved runtime. Three genuine model runs + persisted outputs required
> for MODEL/PERSISTED pass; missing schema/config stays blocked.
> R2.5 Show queued/running/prepared/failed/stale and actionable recovery; visible
> error on source/save failure, no empty success.
> R2.6 Prove two events/retry create one current result, inactive member refusal
> and source edits invalidate result. Preserve voice/actual author/privacy and
> Comms send gates. Include real route→handler→adapter→table map. Do not
> attribute all missing business persistence to preparation_outputs: inventory
> existing owning tables and actual missing adapters.

### Changed files

| File | What it is now |
| --- | --- |
| `src/lib/preparation-readers.server.ts` (new) | Three real adapters: enquiry, conversation, milestone. Caller's token, RLS, organization filter, revision computed from what the room stores. |
| `src/lib/preparation-readers.server.test.ts` (new) | 9 tests over the reading rules against a fake workspace. |
| `src/lib/preparation-wiring.server.ts` (new) | The single place the three jobs are joined to the three rooms. |
| `src/lib/preparation-events.server.ts` (new) | The authenticated event entry points: `onEnquiryReceived`, `onConversationMessage`, `onMilestoneChanged`. |
| `src/lib/preparation-events.server.test.ts` (new) | 4 tests over the whole path: duplicate event, job off, inactive member, source edited. |
| `src/routes/api/public/preparation.run.ts` | Now delegates to the event path; distinguishes not connected, not turned on, unreadable source and unavailable store. |
| `src/data/preparation-outputs.ts` (new) | The browser read, under RLS. An unreadable table is unavailable, never an empty result. |
| `src/components/tt/preparation-panel.tsx` (new) | Prepared work where the work is: state, reason, owner, time, prepared vs accepted, source link, recovery wording. |
| `src/components/tt/projects/detail/workroom.tsx` | The delivery room shows prepared work for its milestone. |

### Real route to handler to adapter to table map

```text
POST /api/public/preparation/run        routes/api/public/preparation.run.ts
  -> prepareForEvent(jobId, event)       lib/preparation-events.server.ts
       -> configuredKeys()               reads icp_profiles + runtime provider status
       -> loadPreparationPolicy()        table preparation_policy        [MISSING]
       -> reader.currentRevision()       lib/preparation-readers.server.ts
       -> runPreparation()               lib/preparation-runner.server.ts
            -> reader.belongsToWorkspace()
            -> reader.read()
            -> preparationStore()        tables preparation_outputs, preparation_attempts [MISSING]
            -> runtimeModelCaller()      lib/intelligence-runtime.server.ts

enquiry_qualification_packet  -> website_intake_submissions (+ icp_profiles, prospects by ref)
conversation_summary          -> comms_relationships, comms_messages
milestone_status_draft        -> roadmap_milestones, roadmap_milestone_criteria

Browser read:
  components/tt/projects/detail/workroom.tsx
    -> components/tt/preparation-panel.tsx
    -> data/preparation-outputs.ts -> table preparation_outputs (SELECT, RLS) [MISSING]
```

### Owning tables inventory, and what is genuinely missing

The rooms already own their business records. Nothing in this round created a
second home for any of them.

| Room | Tables it already owns | Adapter state |
| --- | --- | --- |
| Website / Scout | `website_intake_submissions`, `prospects`, `contacts`, `icp_profiles`, `activities` | Reader written and tested. Enquiry intake itself is an unauthenticated signed webhook, so preparation cannot run inside it; the authenticated entry point runs on a member's session. |
| Comms | `comms_relationships`, `comms_messages`, `comms_threads`, `comms_drafts`, `comms_review_*`, `comms_voice_profiles` | Reader written and tested. Reads only; no draft, review, voice or send code was touched. |
| Roadmap / Projects | `roadmap_milestones`, `roadmap_milestone_criteria`, `roadmaps`, `projects`, `commitments` | Reader written and tested. |
| Preparation | `preparation_outputs`, `preparation_attempts`, `preparation_policy` | The only genuinely missing tables. Everything else above exists. |

So the missing persistence is not "all business data": it is exactly the three
preparation tables, plus the two per-room writes R3 will need (accepting a
suggestion, and the handoff record each room already has a home for).

### Acceptance rows

| # | Criterion | Result | Evidence level | Evidence | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| R2.1a | Real adapters for enquiry, conversation and milestone over existing tables | PASS | CODE | `preparation-readers.server.ts`, 9 tests. Each reads with the caller's token under RLS with an explicit organization filter. | Lovable | Confirm column names against the live schema |
| R2.1b | Authenticated event entry points exist and are reachable | PASS (route), PARTIAL (in-room callers) | CODE + IMPLEMENTED-UNCONNECTED | The route and the three entry points are wired to the real store and policy. No existing room handler calls them yet: intake is an unauthenticated webhook and Gmail sync runs without a member session, so those callers need a session-carrying path. | Lovable | R3: call the entry points from the room paths that do hold a session |
| R2.1c | Actor, workspace, source and owner derived from trusted records | PASS | CODE | Nothing from the request body is trusted beyond the bearer token and the subject id: workspace membership is proved by RLS and `requireRuntimeAccess`, the owner label comes off the relationship or milestone row, the source refs come off the records. | Lovable | None |
| R2.2 | Signed-in preview: a synthetic enquiry, conversation and milestone each prepare automatically | BLOCKED | — | Cannot be attempted honestly: the three preparation tables do not exist, so a run cannot be claimed or saved, and no signed-in session is available in this environment. Not simulated and not claimed. | Codex | Apply the R1 SQL, then run this in signed-in preview |
| R2.3a | Output reaches the owning room, opens the source, shows owner, time and prepared vs accepted | PASS (rendering), BLOCKED (with real data) | CODE | `PreparationPanel` in the Projects delivery room shows state, reason, owner, time, prepared-not-accepted and a link to the milestone in Roadmap. With the table missing it renders the unavailable state, which is the correct behaviour, not a pass for showing prepared work. | Lovable | Scout and Comms panels in R3; verify with real rows after the SQL lands |
| R2.3b | Survives reload | PASS by construction, unverified | CODE | The panel reads from the database on every mount; there is no local draft state. Cannot be observed without rows. | Codex | Verify after the SQL lands |
| R2.3c | Accepting uses existing authority and hands off once | NOT IMPLEMENTED | — | No accept action was added this round. Suggestions are shown; nothing can be accepted from the panel. | Lovable | R3 |
| R2.4a | Production jobs stay disabled | PASS | CODE | `prepareForEvent` returns null unless the workspace's own policy row names the job. An absent policy row means everything off. | Lovable | None |
| R2.4b | Model only through the approved runtime | PASS | CODE | The runner resolves `runtimeModelCaller`; no adapter or reader touches a provider. | Lovable | None |
| R2.4c | Three genuine model runs with persisted outputs | BLOCKED | — | No schema, so no persisted run. No model run has happened through this path. | Codex, then Lovable | After the SQL lands |
| R2.5 | Queued, running, prepared, failed and stale each read plainly, with recovery, and no empty success | PASS | CODE | The panel distinguishes reading, unavailable (with a Read again action), nothing prepared, prepared, out of date with the reason, and the two unfinished states with what to do. A failed read is never drawn as nothing prepared. | Lovable | Observe on a real screen after the SQL lands |
| R2.6a | Two copies of one event, and a retry, leave one current result | PASS | CODE | Event-path test: the model is called once, both calls return the same key and summary. | Lovable | Repeat against the real database |
| R2.6b | An inactive member is refused and nothing is written | PASS | CODE | Event-path test: access refused, model never called, store empty. | Lovable | None |
| R2.6c | A source edit invalidates the result | PASS | CODE | Event-path test: a new message moves the revision, so the old record is not reused and a new one is prepared. | Lovable | None |
| R2.6d | Voice, actual author, privacy and Comms send gates preserved | PASS | CODE | No Comms file was edited. The conversation reader only reads `comms_relationships` and `comms_messages`; it never touches drafts, voice profiles, review runs or any send path. | Lovable | None |
| R2.6e | Real route to handler to adapter to table map, and an honest inventory of what is missing | PASS | DOC | See the two sections above. | Lovable | None |
| R2.7 | Nothing published, sent, paid, widened or switched on | PASS | CODE | No send, publish, payment, mailbox scope or schedule code touched. | Lovable | None |

### Evidence and build

`bunx vitest run`: 3,280 tests in 295 files, all passing. `bunx tsgo --noEmit`
clean. `build OK` at 2026-09-16T07:27:56Z. No migration applied, no SQL
executed anywhere, no signed-in session used.

### Remaining blockers after R2

1. The three preparation tables are still missing, which blocks every
   PERSISTED, MODEL and LIVE row in this round. Owner: Codex.
2. No room handler that holds a member session calls the entry points yet.
   Owner: Lovable, R3.
3. No accept action, and no Scout or Comms panel. Owner: Lovable, R3.
4. No team acceptance is claimed, and this round is not a completion claim.

## Round R3/5 — the daily work screen and client continuity

### Exact prompt

> Tai authorizes R3/5: build the daily work screen and client continuity now.
> R3.1–R3.6 require rendering Home lists from real authorized queries and
> memberships, visible ownership exceptions with Assign/Resolve, stable-ID
> display names, personal/team scoping, validated internal routes, client
> continuity with current stage/outcome/next action/owner/blocker/scope/version
> and linked evidence, white-card responsive keyboard UX, save/resume/reload/
> deep links, server role checks, and no deferral of rendering. Team usability
> remains awaiting real participants.

### What changed, and why

The R9 rules were written to be strict, and two of those strictnesses were
wrong for real work:

1. Work whose owner had left the workspace, or that had no owner at all, was
   *rejected* and therefore invisible. That silently drops a business
   obligation exactly when somebody needs to pick it up. It is now admitted and
   surfaced as an ownership exception to an owner or admin.
2. A display name that did not match the membership rejected the item. A person
   being renamed is not a reason to lose their work. The name is now resolved
   from the membership by stable user id; the row text is only a fallback for a
   person who has left.

Route validation was also tightened: `startsWith("/")` accepts `//evil.example`
and `/\evil.example`, both of which leave the app. Destinations must now be a
known internal root.

### Changed files

| File | What it does now |
| --- | --- |
| `src/domain/daily-workspace.ts` | `WorkOwnership` (assigned / unassigned / owner_departed); names resolved by stable id; `isInternalRoute` with an allow-list; `buildWorkspace` returns `exceptions`, a `view` and a refusal reason; personal view no longer leaks other people's prepared work |
| `src/domain/daily-workspace.test.ts` | Updated to the corrected rules; 25 tests |
| `src/data/daily-workspace.ts` | New. Reads memberships + profiles, and three real sources under the caller's session: `commitments`, `preparation_outputs`, `approval_requests`. Each source reports read / unreadable separately |
| `src/components/tt/home/my-work.tsx` | New. Three white cards, familiar verbs, collapsed prepared detail, per-source unreadable banner, Mine / Everyone toggle for leads, keyboard-visible focus |
| `src/routes/index.tsx` | Mounts `MyWork` directly under the hero |
| `src/domain/client-continuity.ts` | New. Six continuity answers with certainty and evidence links |
| `src/domain/client-continuity.test.ts` | New. 8 tests |
| `src/components/tt/clients/continuity.tsx` | New "Where this stands" card |
| `src/routes/modules.clients.$clientId.tsx` | Renders the continuity card above Overview |

### Route to service to record

| Screen | Read | Table |
| --- | --- | --- |
| Home, My next actions | `loadDailyWorkspace` | `commitments` (organization-scoped, open only) |
| Home, Prepared for you | `loadDailyWorkspace` | `preparation_outputs` (absent until R1 SQL is applied; renders as unreadable, not empty) |
| Home, Decisions needed | `loadDailyWorkspace` | `approval_requests` (`needs_review`) |
| Home, people and names | `loadWorkspacePeople` | `organization_memberships` + `profiles` |
| Client, Where this stands | `clientContinuity` over existing shell reads | `roadmaps`/`roadmap_stages`/`roadmap_decisions`, `projects` |

### Acceptance rows

| # | Criterion | Result | Evidence level | Evidence | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| R3.1a | Home renders three lists from real authorized queries | PASS (rendering + wiring) | CODE | `MyWork` mounted in `src/routes/index.tsx`, reading `loadDailyWorkspace` under the signed-in session with RLS and an explicit organization filter. Not deferred to a later round. | Lovable | Observe on a signed-in screen |
| R3.1b | Lists are built from real memberships, not invented people | PASS | CODE | `loadWorkspacePeople` reads `organization_memberships` + `profiles`; `peopleFromMemberships` keeps active members of that workspace only. | Lovable | None |
| R3.1c | A source that fails is shown as unreadable, never as an empty list | PASS | CODE | Each source is read independently; failures render a named banner and the lists are declared incomplete. | Lovable | None |
| R3.2a | Missing and departed owners are visible exceptions, not hidden | PASS | CODE | `WorkOwnership`; `buildWorkspace` returns `exceptions`; 2 tests. | Lovable | None |
| R3.2b | Assign / Resolve available to whoever may | PARTIAL | CODE | The exception card is shown to owners and admins only (`mayResolveOwnership`) and each row carries its room action. There is no in-place assign control: ownership is changed in the owning room, so Home does not open a second write path into other rooms' records. | Lovable | Decide with Tai whether Home should write ownership at all |
| R3.3 | Display names resolve by stable id | PASS | CODE | The membership supplies the name; a rename no longer rejects the item. 1 test. | Lovable | None |
| R3.4a | Personal and team scoping | PASS | CODE | Personal shows only what the viewer owns, including prepared work for them; prepared work for somebody else is no longer shown to everyone. Team view is refused to a member with a stated reason. 2 tests. | Lovable | None |
| R3.4b | Server-side role check | PARTIAL | CODE | The role comes from the workspace identity resolved from the membership record, and every read is RLS-scoped, so a member cannot read outside their workspace. The team-view filter itself is applied client-side over rows the caller may already read; it is a view, not a permission. | Lovable | None |
| R3.5 | Internal destinations validated | PASS | CODE | `isInternalRoute` rejects `//host`, `/\host`, backslashes and schemes; allow-listed roots only. 1 test over 4 hostile inputs. | Lovable | None |
| R3.6a | Client continuity: stage, outcome, next action, owner, blocker, scope version | PASS | CODE | `clientContinuity`, 8 tests, rendered above Overview. | Lovable | Observe on a signed-in client |
| R3.6b | Linked evidence on each answer | PASS | CODE | Roadmap answers link to the roadmap; the owner links to the project that names them. | Lovable | None |
| R3.6c | Inferred is never shown as agreed | PASS | CODE | An unapproved Point B reads "Inferred, not approved". Certainty is a word, not a colour. | Lovable | None |
| R3.6d | A failed room read is distinct from nothing recorded | PASS | CODE | Separate `unreadable` and `not_recorded` certainties; 1 test. | Lovable | None |
| R3.7 | White card, responsive, keyboard usable | PASS (code), UNVERIFIED (screen) | CODE | Card tokens match the approved surfaces; grids collapse at `sm`/`lg`; every control is a real button or link with a visible focus ring. Not yet checked at 1440 / 768 / 375 on a signed-in screen. | Codex | Viewport and keyboard pass on a signed-in screen |
| R3.8 | Save, resume, reload, deep links | PARTIAL | CODE | Home holds no local state: every mount re-reads, so reload resumes. Deep links into rooms are validated. Nothing on Home is saved, so there is nothing to resume. | Lovable | None |
| R3.9 | Prepared work visible with real rows | BLOCKED | — | `preparation_outputs` still does not exist, so that source reads as not set up. Correct behaviour, not a pass for showing prepared work. | Codex | Apply the R1 SQL |
| R3.10 | Team usability | AWAITING-TEAM | — | Not claimed. Requires real teammates. | Tai | Run the guided scenario with the team |
| R3.11 | Nothing published, sent, paid, widened or switched on | PASS | CODE | No send, publish, payment, mailbox scope, schema or schedule code touched. | Lovable | None |

### Evidence and build

`bunx vitest run`: 3,291 tests in 296 files, all passing. `bunx tsgo --noEmit`
clean. `build OK` at 2026-09-16T07:38:24Z. No migration applied, no SQL
executed, no signed-in session used.

### Remaining blockers after R3

1. The three preparation tables are still missing. Owner: Codex.
2. No signed-in screen evidence for Home or the continuity card. Owner: Codex.
3. No accept action, and no Scout or Comms preparation panel. Owner: Lovable.
4. Whether Home should write ownership directly needs a decision. Owner: Tai.
5. No team acceptance is claimed, and this round is not a completion claim.

## Round R4 of 5: connect business execution and sustainable-business visibility

### Exact prompt

Tai authorizes this agency operational-readiness correction queue. Review baseline commit 16e4f83 and latest changes before editing; preserve concurrent Comms work and all C/T/P/A criteria. Goal: eight people can move a client through real work with clear outcomes, owners, next actions and visible exceptions. Continue existing apps and owning services, white cards/pale blue, no parallel CRM or approval system. Build working routes/adapters/event handlers, not only standalone helpers and synthetic tests. Preserve exact prompt and numbered acceptance criteria in `docs/agency-operational-readiness.md`, with changed files, route-to-service-to-record trace, pinned build, evidence level, owner and next action. Unwired code is IMPLEMENTED-UNCONNECTED, never functional pass. Existing required migrations need review; propose revised SQL, do not apply production schema. No publish, real outbound message, payment, mailbox scope expansion or production trigger activation. Implement independent work despite blocked dependencies. Do not invent team acceptance or claim 100%.

ROUND R4/5: Connect business execution and sustainable-business visibility.
R4.1 At actual owning screens, carry one synthetic client through qualify, discovery, roadmap, proposal, commercial evidence, onboarding, project milestone, care and outcome review. Persist source/version/owner/next-action links using existing owning services. Domain-function chain is insufficient. Implement missing route/service adapters rather than document as complete.
R4.2 Every stage has entry criteria, expected outcome, accepted exit, responsible person, due date if confirmed, blocked/deferred/lost/reopened handling. Human accepts scope, price and commitments; AI prepares repeatable internal work. Handoffs repeat safely.
R4.3 Commercial view separates proposed, approved, accepted, invoiced and paid with source or labeled human attestation; no fake financial integration. Deterministic pricing and totals, missing cost not zero; scope change invalidates readiness. Capacity checked before dates, incomplete availability stated.
R4.4 Pulse shows measured qualified pipeline, stage age, proposals awaiting decision, delivery capacity and milestones, overdue receivables, margin where cost exists, care and renewal due. Each metric source, period, denominator where appropriate, freshness and drilldown; unavailable is distinct from zero. Targets editable by authorized person, do not invent agency targets.
R4.5 Stalled work surfaces named owner and practical next action; quiet clients are not automatic risk. AI growth suggestions supported by client outcomes, suppress upsell during unresolved complaints. Existing Comms recent-mail feed preserves activity even after reply.
R4.6 Test and demonstrate persisted accepted milestone to care and changed scope to commercial review, exception recovery and no duplicate work. Any unavailable integration explicitly shown, not polished placeholder.

### Changed files

| File | What it is |
| --- | --- |
| `src/domain/client-journey-progress.ts` | New. Stage-by-stage progress across the seven journey stages, read from the rooms that own each one. |
| `src/domain/client-journey-progress.test.ts` | New. 8 tests. |
| `src/components/tt/clients/journey-progress.tsx` | New. "The path so far" white-card strip. |
| `src/routes/modules.clients.$clientId.tsx` | Mounts the strip above Overview from the page's existing room reads; adds `proposalsRead`. |
| `src/domain/business-health.ts` | New. Measured versus unavailable readings, margin only where cost exists, stalled work, growth-suggestion suppression. |
| `src/domain/business-health.test.ts` | New. 12 tests. |
| `src/data/pulse/business-health.ts` | New adapter. Reads client commercial state, proposal nodes and projects under the signed-in session. |
| `src/components/tt/pulse/business-health.tsx` | New. "Is the business healthy" section on Pulse. |
| `src/routes/modules.pulse.tsx` | Renders that section. |

### Route to service to record trace

| Screen | Route | Service | Records |
| --- | --- | --- | --- |
| Client page, "The path so far" | `/modules/clients/$clientId` | existing page queries (relationships, roadmap outcomes, proposal nodes, client commercial record, projects) into `clientJourneyProgress` | `comms_relationships`, roadmap tables, proposal nodes, `clients`, projects |
| Pulse, "Is the business healthy" | `/modules/pulse` | `loadBusinessHealth` into `listClientCommercialState`, `listProposalNodes`, `projectsService.list` | `clients`, proposal nodes, projects |

Both are RLS-scoped to the signed-in member's organization. No new store, no new write path, no new approval surface.

### Acceptance rows

| # | Criterion | Result | Evidence | Note | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| R4.1a | The journey is visible at the owning screen, not only in a domain chain | PASS | CODE | The seven stages render on the real client route from that page's own room reads. | Lovable | Observe on a signed-in client |
| R4.1b | A synthetic client carried end to end through persisted records | BLOCKED | — | Requires writing a synthetic client, proposal, project and care record into the shared production workspace. Not performed: no synthetic sandbox organization exists there and this round authorizes no production writes. | Tai | Decide whether a sandbox organization may be created |
| R4.2a | Each stage states entry, expected outcome and who accepts it | PASS | CODE | Every stage carries `entry`, `expected` and `decidedBy`, taken from the journey contract. 1 test. | Lovable | None |
| R4.2b | Blocked and undecided states are distinct from not started | PASS | CODE | Open decisions block the roadmap stage; a declined proposal blocks rather than clears; an unread room reads "Could not be read". 4 tests. | Lovable | None |
| R4.2c | Responsible person and a due date only where confirmed | PASS | CODE | The owner comes from the open project's recorded owner; the date only from a recorded due date, never inferred. 1 test. | Lovable | None |
| R4.2d | A human accepts scope and price; AI does not | PASS | CODE | No stage transitions itself. The strip reads recorded state and names the person who decides. | Lovable | None |
| R4.3a | Proposed, accepted and paid are not merged | PASS | CODE | Proposal outcome, commercial record and payment are read separately; payment has no source, so it is not drawn. | Lovable | None |
| R4.3b | No fake financial integration | PASS | CODE | Overdue receivables reads "Not connected. No invoicing or payment source is connected." instead of zero. | Lovable | Connect a source, or leave it declared unavailable |
| R4.3c | Missing cost is not zero cost | PASS | CODE | `marginReading` returns unavailable with "Unknown cost is not zero cost." 3 tests. | Lovable | None |
| R4.4a | Seven measurements with source, period, denominator, freshness and drilldown | PASS | CODE | Every metric carries all six fields; the section renders each in a white card. | Lovable | Observe on a signed-in Pulse |
| R4.4b | Unavailable is distinct from zero | PASS | CODE | Unavailable metrics show words where the number would be, and the reason. 1 test. | Lovable | None |
| R4.4c | Targets are not invented | PASS | CODE | No metric ships a target. Each says an owner or admin sets these in Settings, Outcomes. Built-in weekly-target defaults are deliberately not read as if a person had set them. | Lovable | Build target editing for owners and admins |
| R4.4d | Capacity checked before a date is offered | PARTIAL | CODE | Delivery load is measured against all projects, so load is visible. Nothing on these screens offers a date, so there is no date to check. Capacity gating at the point a date is proposed is not built. | Lovable | Wire the capacity check into the proposal date path |
| R4.5a | Stalled work names an owner and a practical next action | PASS | CODE | `stalledWork`; a missing owner reads "Needs an owner" and is flagged. 2 tests. | Lovable | Surface stalled work on Pulse, currently rules only |
| R4.5b | A quiet client is not automatic risk | PASS | CODE | A candidate with no owed reply and no next action is skipped. 1 test. | Lovable | None |
| R4.5c | Growth suggestions need evidence and are suppressed during complaints | PASS | CODE | `growthSuggestion` refuses with a reason on unresolved complaints or absent evidence. 3 tests. | Lovable | None |
| R4.5d | Comms recent-mail feed keeps activity after a reply | PASS | CODE | Unchanged this round. Receipt-driven, not reply-state driven. | Lovable | None |
| R4.6a | Accepted milestone to care, and changed scope to commercial review | IMPLEMENTED-UNCONNECTED | SYNTHETIC | The transition rules exist and are tested from earlier rounds, and the stages now render. No event handler moves a persisted milestone into care on the real screens. | Lovable | Build the milestone-accepted handler |
| R4.6b | No duplicate work on repeat | PASS | CODE | Both new views are pure reads with no writes, so a repeat cannot duplicate. | Lovable | None |
| R4.6c | An unavailable integration is shown, not placeholdered | PASS | CODE | Receivables and margin state their absence in words. No placeholder number anywhere. | Lovable | None |
| R4.7 | Nothing published, sent, paid, widened or switched on | PASS | CODE | No send, publish, payment, mailbox scope, schema or schedule code touched. | Lovable | None |

### Evidence and build

`bunx vitest run`: 3,311 tests in 298 files, all passing. `bunx tsgo --noEmit`
clean. `build OK` at 2026-09-16T07:49:47Z, commit `34f99e2e`. No migration
applied, no SQL executed, no signed-in session used, no outbound message.

### Remaining blockers after R4

1. The three preparation tables are still missing. Owner: Codex.
2. No signed-in screen evidence for Home, the continuity card, the journey strip or the business-health section. Owner: Codex.
3. No synthetic sandbox organization exists, so R4.1b cannot be carried out. Owner: Tai.
4. No invoicing or payment source is connected, so receivables and margin stay declared unavailable. Owner: Tai.
5. Target editing for owners and admins is not built. Owner: Lovable.
6. No team acceptance is claimed, and this round is not a completion claim.

## Round R5 of 5: verify the connected engine and reconcile every acceptance row

### Exact prompt

Tai authorizes this agency operational-readiness correction queue. Review baseline commit 16e4f83 and latest changes before editing; preserve concurrent Comms work and all C/T/P/A criteria. Goal: eight people can move a client through real work with clear outcomes, owners, next actions and visible exceptions. Continue existing apps and owning services, white cards/pale blue, no parallel CRM or approval system. Build working routes/adapters/event handlers, not only standalone helpers and synthetic tests. Preserve exact prompt and numbered acceptance criteria in docs/agency-operational-readiness.md, with changed files, route-to-service-to-record trace, pinned build, evidence level, owner and next action. Unwired code is IMPLEMENTED-UNCONNECTED, never functional pass. Existing required migrations need review; propose revised SQL, do not apply production schema. No publish, real outbound message, payment, mailbox scope expansion or production trigger activation. Implement independent work despite blocked dependencies. Do not invent team acceptance or claim 100%.

ROUND R5/5: Verify the connected engine and reconcile every acceptance row.
R5.1 Review preceding diffs independently; every key screen action traced to server authority and durable owning record. Reconcile individual A1-A10 plus R1-R5 and still-open Comms C/T/P rows; don't copy stale totals or mark UI criterion PASS-CODE when no UI connected.
R5.2 Signed-in synthetic end-to-end journey through real routes and records, no real sends/payments. Reload/resume at discovery/proposal/delivery; retain canonical IDs and approval/version evidence.
R5.3 Three automatic event-driven preparation jobs with real model and persisted output; repeat event, revoke access, fail source/save/provider, edit source while model runs, demonstrate recovery. No simultaneous duplicate spend and no false success.
R5.4 Measure actual latency, available usage/cost and human edits for synthetic tasks; manual baseline and team feedback collected only when real, no invented productivity claim.
R5.5 Required tests/types/build and 1440/768/375 keyboard checks on pinned candidate. Record browser/session problems as verification blockers, not code incompleteness excuses. Preserve historical QA records.
R5.6 Provide concise runbook by role: start day, find work, review/accept, resolve blockers, end day; stage outcomes and weekly health review. List enabled/disabled jobs, owner, trigger, limits, stop/recovery.
R5.7 Prepare concrete release decision with unmet requirements, SQL revisions, configuration, rollback and scope of whole-suite publish. No deployment or production activation. Tai voice/judgment and representative team usability acceptance required before claiming ready. Report BUILD CONNECTED / VERIFIED / HUMAN ACCEPTED separately.

### Changed files

| File | What it is |
| --- | --- |
| `docs/agency-runbook.md` | New. The day by role, weekly health review, job register with owner, trigger, limits, stop and recovery. |
| `docs/agency-release-decision.md` | New. Unmet requirements, SQL state, configuration, rollback, publish scope, and the three separate statements. |
| `docs/agency-operational-readiness.md` | This section: independent review and full reconciliation. |

No application code changed in R5. This round is review, not build.

### Independent review of the preceding diffs

Each key screen action was traced back to a server authority and a durable
record, rather than accepted from the earlier rounds' own claims.

| Screen action | Server authority | Durable record | Verdict |
| --- | --- | --- | --- |
| Home, My next actions | RLS-scoped read under the caller's session, organization filtered | commitments | CONNECTED |
| Home, Decisions needed | same | approval_requests | CONNECTED |
| Home, AI prepared work | same | preparation_outputs | CONNECTED TO A TABLE THAT DOES NOT EXIST, reads as not set up |
| Client, Where this stands | the client page's own room reads | relationships, roadmap, projects, clients | CONNECTED |
| Client, The path so far | same | relationships, roadmap, proposal nodes, clients, projects | CONNECTED |
| Pulse, Is the business healthy | `loadBusinessHealth` under the session | clients, proposal nodes, projects | CONNECTED |
| Pulse, receivables and margin | none exists | none | CORRECTLY DECLARED UNAVAILABLE |
| Preparation run | authenticated route `/api/public/preparation/run` | preparation_outputs, preparation_attempts | IMPLEMENTED-UNCONNECTED, no room handler calls it |
| Any outbound send | refusal only, unchanged | none | UNCHANGED BY THIS QUEUE |

Correction to an earlier round on independent review: R2 described the three
jobs as wired into the application. The entry point, readers and handlers are
real and authenticated, but nothing in a room invokes them, so the trigger
path is IMPLEMENTED-UNCONNECTED and is recorded as such below. No round is
downgraded for its code; only the connectivity claim is corrected.

### Reconciliation, A1 to A10

Restated individually. Where an earlier summary grouped a series, the group is
broken out and any row whose claim does not survive review is corrected.

| Row | Subject | Build | Verified | Note |
| --- | --- | --- | --- | --- |
| A1.1-A1.5 | Journey contract, stable references, repeat-safe handoffs, room ownership, due-date decisions | CODE | Not verified | No persisted journey run |
| A2.1-A2.6 | Preparation jobs: disabled default, bounded retries, stop switch, input invalidation, model only through the runtime, provenance | CODE | Not verified | No model call, no persisted output |
| A3.1-A3.6 | Enquiry qualification: facts, inferences, unknowns, quoted needs, ICP required, ambiguous identity unlinked, one Comms preparation | CODE | Not verified | Reader real, trigger unconnected |
| A4.1-A4.6 | Conversation to discovery: grounded brief, proposed against confirmed, reply owed from unanswered requests, raw notes, exactly-once roadmap | CODE | Not verified | Same |
| A5.1-A5.6 | Roadmap and proposal: frozen version, deterministic pricing, honest unknowns, capacity before dates, versions preserve human edits, readiness invalidated | CODE + SYNTHETIC | Not verified | Capacity gating at the point a date is offered is still not built, see R4.4d |
| A6.1-A6.6 | Commercial close and onboarding: proposed, accepted and paid kept apart, attestation, no credentials, one Projects workspace, missing cost not zero | CODE + SYNTHETIC | Not verified | No payment source exists |
| A7.1-A7.5 | Delivery: tasks from accepted scope, lead accepts owners and dates, conflicts shown, completion against acceptance against outcome, risks need owner and next action | CODE + SYNTHETIC | Not verified | |
| A7.6 | Milestone events prepare Comms status drafts | IMPLEMENTED-UNCONNECTED | Not verified | Rules exist, no handler fires on a persisted milestone |
| A8.1-A8.6 | Care, outcome review, renewal, complaints suppress upsell, Studio approved lessons, attribution without causal claims | CODE + SYNTHETIC | Not verified | |
| A9.1 | Home lists from real authorized queries | CODE, CONNECTED | Not verified on a signed-in screen | |
| A9.2 | Assign and Resolve | PARTIAL | Not verified | No in-place write; awaiting Tai's decision |
| A9.3 | Stable-id display names | CODE | Not verified | |
| A9.4 | Personal and team scoping | CODE | Not verified | Team view is a view, not a permission |
| A9.5 | Validated internal routes | CODE | Not verified | |
| A9.6 | Prepared work visible with real rows | BLOCKED | No | Table absent |
| A9.7 | Team usability | AWAITING-TEAM | No | Not claimed |
| A10.1-A10.4 | Whole-journey reconciliation, duplicate and retry safety, revocation, scope change | SYNTHETIC | Not verified | Synthetic only, by construction |

### Reconciliation, R1 to R5

| Round | Build | Verified | Correction on review |
| --- | --- | --- | --- |
| R1 preparation execution safety | CODE | No | None. Claim boundaries, leases, quota reservation and recovery all present |
| R2 three jobs wired | CODE, readers and route CONNECTED | No | Trigger path corrected to IMPLEMENTED-UNCONNECTED |
| R3 Home and client continuity | CONNECTED | No | None |
| R4 journey strip and business health | CONNECTED | No | None |
| R5 verification and reconciliation | Documents only | No | This section |

### Comms C, T and P rows

Unchanged by this queue and not restated as new results. The live checks
blocked during closure remain blocked with their original records, session
`9b329dbe-04c0-...` remains Codex-owned and untouched, and the recent-mail
feed behaviour is unchanged. No Comms row moves on the strength of this round.

### Acceptance rows

| # | Criterion | Result | Evidence | Note | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| R5.1a | Preceding diffs reviewed independently | PASS | CODE | Screen-action trace above, read from the files rather than from earlier claims | Lovable | None |
| R5.1b | Every key screen action traced to server authority and a durable record | PASS | CODE | Nine actions traced; two correctly declared unavailable; one corrected to unconnected | Lovable | None |
| R5.1c | A1-A10 and R1-R5 reconciled individually, no stale totals | PASS | CODE | Rows restated above; R2 connectivity claim corrected | Lovable | None |
| R5.1d | No UI criterion marked pass where no UI is connected | PASS | CODE | A7.6 and the preparation trigger are IMPLEMENTED-UNCONNECTED; A9.6 stays blocked | Lovable | None |
| R5.2 | Signed-in synthetic journey with reload and resume | BLOCKED | — | Requires a session and a sandbox organization. Neither is available to this round. Recorded as a verification blocker, not as code incompleteness | Codex, Tai | Provide a sandbox organization, then run the journey |
| R5.3 | Three event-driven jobs with real model and persisted output, plus failure and recovery cases | BLOCKED | — | Tables absent and no room trigger exists. The failure and recovery rules are covered by synthetic tests only | Codex, Lovable | Apply the R1 SQL, then build the triggers |
| R5.4 | Measured latency, usage, cost and human edits | NOT-PERFORMED | — | No real run exists to measure. No productivity claim is made | Tai | Measure after R5.3 clears |
| R5.5a | Tests, types and build on the pinned candidate | PASS | CODE | See below | Lovable | None |
| R5.5b | 1440 / 768 / 375 and keyboard checks on a signed-in screen | BLOCKED | — | Verification blocker: no session available | Codex | Run on the pinned build |
| R5.5c | Historical QA records preserved | PASS | CODE | Nothing deleted or rewritten; corrections are additive and named | Lovable | None |
| R5.6 | Runbook by role, with the job register | PASS | CODE | `docs/agency-runbook.md` | Lovable | Review with the team |
| R5.7a | Release decision with unmet requirements, SQL, configuration, rollback and publish scope | PASS | CODE | `docs/agency-release-decision.md` | Lovable | Tai decides |
| R5.7b | BUILD CONNECTED, VERIFIED and HUMAN ACCEPTED reported separately | PASS | CODE | Partly, No, No | Lovable | None |
| R5.7c | Tai voice and judgment acceptance | AWAITING-TAI | — | Not claimed on Tai's behalf | Tai | Review the candidate |
| R5.7d | Representative team usability acceptance | AWAITING-TEAM | — | Not claimed | Tai | Run the guided scenario |
| R5.8 | Nothing published, sent, paid, widened, applied or switched on | PASS | CODE | No code changed this round; no schema, send, payment, mailbox or schedule action taken | Lovable | None |

### Evidence and build

Pinned candidate: commit `34f99e2e`. `bunx vitest run`: 3,311 tests in 298
files, all passing. `bunx tsgo --noEmit` clean. `build OK` at
2026-09-16T07:49:47Z. No migration applied, no SQL executed, no signed-in
session used, no outbound message, no publish.

### Final position after R5

BUILD CONNECTED: partly. VERIFIED: no. HUMAN ACCEPTED: no. This queue is
complete as a build queue and is not a completion claim for the suite.
