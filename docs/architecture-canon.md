# Trust Tai OS, architecture canon

The source of truth for any future work in this codebase, human or AI. Short on purpose.
If a change contradicts this document, the change is wrong until this document is changed
deliberately.

**The law**

> Apps own state. Core owns identity. The event stream owns history.
> Steward owns interpretation. Pulse owns visibility.

**Operating principle: small input, deep intelligence, clear output.**

## Product law. Familiar Magic (locked 2026-08-22)

Permanent product doctrine. Every room, feature and agent decision is judged
against this section first; the architecture rules below describe how, this
section describes what deserves to exist.

> Build on models people already understand. Add intelligence, judgment,
> memory and usefulness they did not know they could expect.

**The seven laws**

1. **Surface law.** Familiar on the surface. Exceptional underneath.
2. **Outcome law.** Never invent a new experience where a familiar one already
   serves the user well. Invent only where the existing model prevents a
   better outcome.
3. **Intelligence law.** AI must remove effort, improve judgment, preserve
   context or create momentum. If it only produces more text, it is not
   intelligence.
4. **Action law.** Every meaningful recommendation should be capable of
   becoming an action.
5. **Proof law.** attempted != executed != verified != human accepted.
6. **Memory law.** Every accepted outcome should leave reusable memory behind.
7. **Subtraction law.** Features that do not help the user reach the outcome
   faster, more confidently, or with less cognitive effort should not survive
   merely because we can build them.

**The suite hit test.** Every app must explicitly define and pass all ten:

1. **Job**, the one job it exists to perform.
2. **Hit behavior**, the repeat behavior that makes someone naturally return.
3. **Familiar reference**, proven interaction/product behaviors already
   understood by users.
4. **Magic**, what Trust Tai adds that the familiar model does not.
5. **Intelligence**, what it must retrieve, remember, reason about and verify.
6. **Actions**, what it can actually do, not just recommend.
7. **Human gates**, where Tai must decide/approve.
8. **Memory**, what should compound through use.
9. **Proof**, how the app knows the desired outcome actually happened.
10. **Subtraction**, what should be removed or hidden because it does not
    serve the job.

Each room's answers live in its own hit brief under `docs/` (for example
`docs/comms-hit-brief.md`), written against the current implementation, never
against aspiration.

**Shared UX primitives.** These are suite-level patterns, not app-specific
inventions: **Attention** (what needs me?), **Timeline** (what happened?),
**Understanding** (what does the system think is happening?),
**Recommendation** (what should happen next?), **Approval** (do I allow
this?), **Work** (what is happening now?), **Evidence** (how do we know it
worked?), **Memory** (what have we learned?). Reuse existing design-system
patterns where possible; do not create a giant abstraction layer for its own
sake.

**Locked hit behaviors.**

| Room | Hit behavior |
| --- | --- |
| Scout | Show me people worth knowing. |
| Comms | Help me never lose an important relationship. |
| Roadmap | Tell me what should happen next and why. |
| Projects | Give it what happened. Review what it understood. Approve the work. |
| Ops | Tell it what is wrong. Let it investigate and resolve it. |
| Steward | Remember what we said we would do. |
| Pulse | Tell me what changed that actually matters. |
| Studio | Turn one thought into something worth publishing. |
| Conductor | Help me decide what deserves my attention and what should happen next. |

**Suite migration order.** Core/Foundation → Comms → Scout → Projects → Ops →
Roadmap → Steward → Pulse → Studio → Conductor. Do not reorder without an
explicit reason recorded in this doctrine.

## 1. Suite topology

| Layer | Rooms | Owns |
| --- | --- | --- |
| Core (shell) | Home | Identity, organization, navigation, shared entities, access |
| Business | Scout, Comms, Roadmap, Projects, Ops, Studio | Domain state |
| Stewardship | Steward | Interpretation, memory, judgment, recommendation, routing |
| Intelligence visibility | Pulse | The suite-wide readout |

`layer` on every `AppRegistration` in `src/domain/registry.ts` encodes this. It is not
cosmetic: only `business` rooms may own domain truth.

## 2. Module ownership boundaries

- **Scout**, prospects, fit evidence, discovery of companies and decision-makers.
- **Comms**, relationships, conversations, threads, replies, promises to people.
- **Roadmap**. Point A → Point B strategy, milestones, sequencing, roadmap decisions.
- **Projects**, execution, ownership, delivery state, blockers.
- **Ops**, websites, technical health, maintenance (external app, SSO room in shell).
- **Studio**, content and produced assets.

No other module may claim these. Reading them is always allowed; owning them is not.

## 3. Shared core entities

`src/domain/entities.ts` holds `Organization`, `User`, `Client`, `Contact`, `Prospect`,
`Project`, `Website`, `Conversation`, `Task`, `Decision`, plus `EntityRef` and
`LifecycleStatus`.

**Apps extend and reference these; they never duplicate them.** No `comms_client`, no
`steward_project`, no per-module copy of a contact. App-specific detail attaches to a core
entity by id.

## 4. Cross-app event law

One stream: `public.activities`, written through `ActivityStream` and the shared vocabulary
in `src/domain/events.ts` (`entity.action`, e.g. `prospect.qualified`).

- Only the room that owns the state may emit the event about it (`emittedBy`).
- Every event carries `Provenance`: app, actor, when observed, observed vs inferred.
- The stream is append-only history. It is not a message bus, a queue, or a second store.
- Local, app-private history may exist, but only the shared vocabulary is promised to
  other rooms.

## 5. Steward law

Steward is a layer, not a peer business domain.

1. It interprets meaning, holds memory and beliefs, forms judgment, recommends, and routes.
2. It **does not own** conversations, tasks, decisions, project risk or client risk. Those
   remain with the owning module and the core entities.
3. It writes only interpretation and memory (its belief ledger) plus decisions people made
   about its proposals.
4. Its UI route `/modules/steward` stays; the route is a surface, not a claim of ownership.
5. `steward.write` never substitutes for the owning room's write permission.

## 6. Pulse law

Pulse is the primary visibility/readout surface for suite-wide intelligence: the read, what
it rests on, what could not be read, and the learning trail. Pulse owns no entity, emits no
suite event, and executes nothing.

## 7. Human approval and action boundary

- Intelligence never silently executes consequential work.
- Every `ActionProposal` carries `requiresApproval: true`, bounded `willDo` / `willNotDo`.
- Only reversible work is proposed; irreversible work stays advice.
- Authorisation is role-bound per owning room (`src/domain/action-authority.ts`) and is
  re-checked in `intelligenceService.authorizeAction()`, which fails closed.
- Authorising records permission and routes the person to the owning room. The room
  executes.

## 8. One organization boundary, fail closed

One identity (Supabase Auth), one organization model, membership verified through
`organization_memberships` before any workspace data. RLS is the real boundary;
`src/domain/access.ts` is the typed mirror of it. No demo access, no silent membership
creation, no anonymous variant. With no verified membership, the workspace locks.

## 9. One codebase, modular monolith first

A single TanStack Start app with modular domains. No microservices, no per-module database,
no second event store, no premature extraction. Ops is external because it already was.

## Handoff law

A handoff moves a **reference plus reasoning**, never a copy of a record.

1. Every handoff carries the upstream stable id (`prospectId`, `relationshipId`,
   `milestoneId`, `roadmapId`) and its provenance tier. The downstream room reads
   upstream truth through that id; it never re-types or re-researches it.
2. Every handoff is idempotent. A repeated route is a no-op: receivers look up the
   existing downstream record by upstream id, and suite events carry a
   `sourceEventKey` written to the unique `activities.source_event_key` column.
3. A human decision stays `decided` downstream. Inference may never overwrite it.
4. Weak evidence does not open the next room. Each boundary has an explicit
   readiness gate that names what is missing rather than proceeding hopefully.

Current gates: Scout → Comms (`buildHandoffDraft.ready`), Comms → Roadmap
(`roadmapHandoffReadiness`), Roadmap → Projects (`projectFromMilestone`, approved
milestones only), Projects → Ops/Studio (`buildRouteRequest`).

**A route is a request. Acceptance belongs to the receiving room.**

Projects may route specialized work outward (`src/domain/project-routing.ts`) and emit
`project.routed_to_ops` / `project.routed_to_studio`, because "Projects asked another room
to take this" is Project-owned truth. Projects creates no Ops website, monitoring record
or Studio asset, and never records acceptance. The receiving room owns acceptance and
execution state and emits `ops.work_accepted|started|completed` /
`studio.work_accepted|started|completed`. Those definitions exist in the shared
vocabulary; receiver-side emission is deferred until Ops and Studio can persist it
cleanly. Routing requires a human with `projects.write`; intelligence may only propose it
as a bounded `ActionProposal`.

Cross-app moments are emitted once, by the owning room, in the shared vocabulary
of `src/domain/events.ts` via `emitSuiteEvent`. Room-local history stays a plain
activity. Steward and Pulse read this stream; they never write to it.


## Routed work: withdrawal, silence and notification

A route is a request. Three additions keep it honest end to end:

- **The ledger is read, not stored.** `src/domain/route-ledger.ts` folds the
  shared activity stream into one row per route (`project.routed_to_*` +
  `ops|studio.work_accepted` + `project.route_withdrawn` +
  `project.route_notified`). No second table, no duplicated truth.
- **Withdrawal beats late acceptance.** A withdrawn route can never become
  accepted; acceptance recorded afterwards is kept visible as *refused*.
  Only a person with `projects.write`, giving a reason, may withdraw.
- **Silence is reported, not blamed.** A request unanswered for
  `UNANSWERED_AFTER_DAYS` (3) surfaces on Pulse with its evidence and a link
  back to the owning project, the only room that can withdraw or chase.
- **Notification is best effort and recorded.** Projects tells the receiving
  room through `/api/public/routing/notify`, which forwards references only to
  a server-configured inbox (`OPS_ROUTING_INBOX_URL` /
  `STUDIO_ROUTING_INBOX_URL`). A missing inbox is an ordinary recorded outcome,
  never a failed user action and never a claim that somebody was told.


## The Conductor law

**The Conductor coordinates. Steward interprets. Owning rooms execute.**

The Conductor (`src/domain/conductor.ts`, `src/data/intelligence/conductor/*`,
surface at `/modules/conductor`) is an intelligence-layer room, not a business
app. It holds no business truth of its own and writes none: it reads the same
authorized suite snapshot the intelligence engine reads, through existing data
boundaries and organization scoping.

- **It never invents.** Every number carries a basis, observed, decided,
  derived or unknown. A metric with no instrumentation is reported as a blind
  spot, never estimated. A goal with no decided target is refused, not guessed.
- **Human-decided truth is never overwritten.** Decided values outrank derived
  ones and are echoed back unchanged.
- **It plans only where assumptions hold.** An operating plan is produced only
  when its required inputs are known; otherwise it states what is missing.
- **Risk is causal, not cosmetic.** Leading-vs-lagging risk is derived from the
  factory graph, so an upstream drought is named before the downstream number
  falls.
- **Control is proposal-first.** The Conductor may prepare a typed action graph
  across rooms. Every consequential step requires a human with the owning app's
  authority, and executes in that room's service. The Conductor never writes to
  Scout, Comms, Roadmap, Projects, Ops or Studio, and never mutates itself.


## Conductor control law (V2)

Approval is permission, never execution.

- **The queue is governance, not truth.** `conductor_actions` and
  `conductor_receipts` hold references and decisions. No room's record is
  copied into them, ever.
- **Adapters are the only door.** The Conductor reaches a room solely through
  `src/data/conductor/adapters.ts`, which calls that room's existing service,
  with that room's own permission and RLS still enforced inside it. No generic
  table write exists, and no adapter may act for a room other than its own.
- **Selective and reversible.** A person approves, holds, rejects or withdraws
  each step individually, with a reason. A prerequisite that has not reached
  its room blocks its dependents by name.
- **External work is never routed.** Anything whose effect leaves the building
  stays advice, done by a person.
- **Nothing is done until the owning room says so.** Routing means handed over.
  Completion is reported by the receiving room; it is never inferred, and the
  Conductor's own words are constrained accordingly.
- **Failure is recorded, not swallowed.** Every hand-over writes a receipt, routed, refused or failed, and a governance event in the shared stream.

## 10. Paperclip bridge law (external execution handoff)

Trust Tai routes bounded work to Paperclip agents through `execution_bindings`.
The bridge follows handoff law: a reference plus reasoning, idempotent, never
inferring completion. Contracts that future bridges must honor:

1. **`source_entity_id` is a UUID.** The `execution_bindings.source_entity_id`
   column is Postgres `uuid`. Callers (`assignPaperclipTask`) pass the Trust Tai
   source entity's real id, a task key, milestone id, or generated UUID. Never
   a free-form string key (`"my-task-1"` fails with
   `invalid input syntax for type uuid` at insert).
2. **Idempotency keys are structured**: `trusttai:task:<orgId>:<sourceEntityId>`.
   Retries return the existing binding; no duplicate Paperclip issue is created.
3. **Pause is agent status, not a flag.** Paperclip models pause as
   `status: "paused"` (AGENT_STATUSES). `{ paused: true }` is silently ignored;
   `pausedAt` populates only on company-level pause and must never be used as
   the pause signal.
4. **Wake requires a JSON object body.** `POST /api/agents/:id/wakeup` with no
   body returns 400 (validation). `triggerHeartbeat` sends `{}`.
5. **Completion converges via the reconcile loop, not the page.** The 5-minute
   sweep (local launchd while Paperclip is laptop-local; edge fn when it has a
   public URL) projects Paperclip issue status into bindings and agent state.
   Steward reads; it never claims completion Paperclip has not reported.

## 11. Intelligence Runtime law

**No business app may become its own isolated AI brain.** Scout, Comms, Roadmap,
Projects, Ops, Studio, Steward and Conductor all reason through one shared
runtime, same evidence discipline, same capability registry, same
problem-solving protocol, same completion gate.

1. **One reasoning boundary.** `src/lib/intelligence-runtime.server.ts` is the
   only suite reasoning entry point. It sits on the transport
   (`roadmap-research.server.ts`), provider configuration
   (`scout-provider.server.ts`) and gateway plumbing (`ai-gateway.server.ts`).
   Rooms never import those directly. The guard
   (`src/lib/intelligence-runtime-boundary.test.ts`) fails CI on any new bypass;
   pre-runtime call sites are documented exceptions with named migrations.
2. **Retrieval before generation.** Every reasoning pass composes its bundle
   through `src/data/intelligence/runtime/retrieval.ts`: the room's evidence,
   human decisions, withheld rooms, canon patterns, prior experience
   (corrections first) and the capability view. The model sees the serialized
   bundle and nothing else.
3. **Operator output, never chain-of-thought.** The `RuntimeRead` contract
   (`src/domain/intelligence-runtime.ts`) separates facts, interpretations,
   knowledge, unknowns, next steps, confidence and verification into distinct
   fields with provenance on each. Facts cite evidence; interpretations are
   labelled inference; confidence is capped by the evidence that exists.
4. **The protocol is shared.** inspect → retrieve → hypothesise → test safely
   → observe evidence → adjust → act within boundary → verify → escalate.
   A failed attempt produces the next bounded diagnostic step; escalation
   names exactly what is missing and who must supply it. "Couldn't complete"
   without a next step is a contract violation.
5. **Completion requires proof.** The gate
   (`src/data/intelligence/runtime/verification.ts`) refuses "the action ran"
   as completion. Claims carry test results, changed state, API responses,
   artifacts, met acceptance criteria, downstream receipts or human
   acceptance. A runtime, adapter or agent may never grade its own homework.
6. **Readiness is declared and tested.** Every registered room carries a
   code-backed manifest (`src/data/intelligence/runtime/manifest.ts`) across
   the eight aspects: evidence grounding, retrieval, domain patterns,
   capability awareness, safe diagnostic loop, verification, approval
   boundary, outcome learning. Acceptance tests
   (`src/data/intelligence/runtime/acceptance.test.ts`) enforce the floor.
7. **Projects is the proof.** Before a milestone is executable, Projects asks
   the runtime for an operator read (`src/domain/project-operator-read.ts`,
   `src/data/projects/operator-read.ts`): missing context, pattern knowledge,
   risks, dependencies, proposed acceptance criteria, capability fit and the
   verification plan, grounded in the milestone's context packet.

## 12. Commercial tier and delivery execution are independent (locked 2026-09-06)

A client's commercial tier (`build`, `run`, `dormant`) is commercial truth,
entered by a person on the Clients commercial panel. A project's execution
state (`not_started`, `in_flight`, `in_review`, `blocked`, `delivered`) is
delivery truth, moved on the project. Neither derives, implies or moves the
other. A client on Run may hold projects in flight; a client on Build may hold
none. No screen may infer tier from delivery, or delivery from tier, and no
service may write one as a side effect of the other.

## 13. Project Chat law (locked 2026-09-06)

**Chat is how you talk to the project. Projects remains where project truth
lives.**

- Chat runs on the shared Intelligence Runtime boundary
  (`runtimeModelCaller`, room `projects`, existing purpose `research`). There is
  no per-project model, no per-project configuration and no second brain.
- Its only ground is that project's context packet, read under the caller's own
  session, plus whatever the person pasted for that turn.
- Chat performs no autonomous writes. Work, blockers, decisions, owner,
  waiting, files and state all change through the Projects services and their
  human gates.
- A chat transcript, if it is ever persisted, is interaction context. It is
  never business truth and never evidence.
- An outcome only counts once a person accepts it and it is recorded through
  the owning service, at which point it compounds into existing Project
  knowledge and state. Proof of anything comes from owning services, activity
  events and evidence, never from what the chat said.
- No duplicate task, note or chat CRM is created for projects.

**The proposal loop (locked 2026-09-06).** Chat may ask for a change; it may
never make one.

- A message is read into at most one bounded, project-owned action
  (`src/domain/project-chat-proposal.ts`). Anything outside that set is refused
  by name, and the room that does own the truth is named and linked: Clients
  for the company and commercial tier, Roadmap for lineage, Comms for sending.
- A proposal shows the field, the store that holds it, what the record says
  now and what would be recorded instead. It is session state, never a row.
- Approval is explicit and human. Discarding writes nothing.
- On approval the record is re-read. If the field moved since the proposal was
  prepared, the write is refused and the person is asked again against current
  truth. If the record already says the proposed value, nothing is written a
  second time.
- The write itself goes through the same Projects service, the same
  `checkDetailEdit` and `checkTransition` refusals and the same activity events
  as the Manage panel. Chat is a doorway into that path, never beside it.
- An owner is resolved to a member of this workspace, never a typed name.
- Sources link through the existing `project_thinking_sources` path, and the
  honest sync state is said out loud: a link is a link until something reads it.
- Success is claimed only after the canonical write lands.


## 14. Client Relationship is a read-only window onto Comms (locked 2026-09-06)

The Relationship tab on a client is a client-scoped read of Comms: who is
known, what has actually been exchanged, the last thing said in each
direction, and the one obligation Comms already derived. Comms owns
conversations, threads, replies, promises and sends. Clients adds no reply
control, no send, no second obligation system, and deep-links into Comms for
anything that acts.

## 15. Project Update resolves what the page flags (locked 2026-09-06)

If the project page flags a condition, the same Update project experience must
carry the control that resolves it: a state that can be moved, a block that can
be recorded, an owner that can be handed over, a wait that can be set and
cleared. Waiting is not a status. It stays derived from `waitingOn` on an
in-flight project, and clearing `waitingOn` is how a wait ends.

## 16. Operability. No dead ends (locked 2026-09-06)

**The house should be doors and windows, not just a frame.** A surface is not
complete because it can display or create a record.

- Every human-owned truth shown in a working room has an intentional lifecycle:
  create, read, update or correct, resolve or close where that applies, and a
  way back from a mistake.
- If the room owns the truth, the control that changes it is reachable in that
  room. If another room owns it, the surface deep-links to the owning room. A
  diagnosis with no action is a defect, not a design.
- Every empty, warning, waiting, blocked or incomplete state answers "what can
  I do next?" whenever a legitimate human action exists.
- Manual create is first class. Where a model can generate a record, a person
  must be able to create the same record by hand, without a model call, and the
  manual path may write Decided truth directly because typing it is the
  decision. Generation stays assistance, never the only doorway. A manual path
  asks only for what the store genuinely requires and leaves everything else
  honestly empty rather than defaulting it.
- Read-only is a statement about ownership or authority, said out loud. A field
  is never read-only because the screen forgot a control.
- Changes go through the owning service, under RLS, with the existing
  provenance and activity trail. No parallel stores, no hidden mutation paths.
- Acceptance covers lifecycle, not only render.

### Captain acceptance checklist

Every new or changed surface answers these nine, in the slice that ships it:

| # | Question | Pass means |
| - | -------- | ---------- |
| 1 | Owner | One room owns this truth, and it is named. |
| 2 | Read | A person can see the current recorded value. |
| 3 | Create | A person can record it, or it is explicitly derived. |
| 4 | Edit / correct | A person can fix what they typed, here or via a named deep link. |
| 5 | Resolve / archive | Closable things can be closed, when that applies. |
| 6 | Empty / error recovery | Every empty or failed state offers the next legitimate action. |
| 7 | Provenance | The change lands in activity with actor and time. |
| 8 | Runtime proof | The path was exercised in a running build. |
| 9 | Production proof | The human gate was met, or the gate is recorded as still open. |

Rows that genuinely do not apply are marked "not applicable, because ...".
Silence is not a pass.

## Canon 17: The Project Workroom

The Project is where the work comes together. Other rooms own truth; the
Project composes and operates that truth through the owning room's canonical
service. A person is not sent to another room for a legitimate project-scoped
action when the owning service can be invoked safely from here.

Consequences:

- Roadmap owns milestones. Project reads and writes them only through
  `roadmapIntel` and `roadmapService`. Projects never stores a milestone.
- Candidate generation from a Project uses the same research run as the
  Roadmap room (`runRoadmapResearch`). There is no second generator and no
  second store. Candidates land Inferred and Proposed; a human approves.
- Manual creation stays the primary human path. AI generation is secondary.
- Clients summarizes the company. It never duplicates the Project workroom.

### Human navigation model: five surfaces

The Project detail page presents five surfaces, not a list of internal
subsystems. Data ownership is unchanged; only navigation is:

| Surface | Contains |
| ------- | -------- |
| Overview | Identity, execution state, Point A / Point B, approvals summary, Work, Blockers, Decisions |
| Chat | Project Chat and its bounded proposal flow |
| Roadmap | Linked roadmap, destination, milestones, add / generate / approve / metric |
| Files | Files, Assets, Knowledge, Context and linked sources |
| Activity | The event stream |

Re-homed sections keep stable anchors (`project-section-<section>`) so any
deep link or in-page jump still lands on them. `surfaceForSection` in
`src/domain/project-workroom-ia.ts` is the single mapping.

## Canon 18: The Client Account (locked 2026-09-07)

Client is the account. Project is the work. Roadmap is the plan.

The Client page answers one question: **what is the state of this relationship
and this company?** It composes the account from the rooms that own the truth
and it operates only what the account itself owns. It is never a second CRM, a
second project store, a second roadmap, a second message store or a second
chat truth.

### Human navigation model: six surfaces

The Client detail page presents exactly these, in this order:

| Surface | Contains |
| ------- | -------- |
| Overview | Identity, commercial state, what needs attention, a compact Direction read, a website summary, the projects line |
| Projects | The projects that name this company, each a door into its project workspace |
| Relationship | The client-scoped read of Comms, under Canon 14 |
| Commercial | The human-entered commercial controls for this account, and proposals |
| Files | Files on this company's projects and its genuinely linked working sources |
| Chat | Client Chat and its bounded proposal flow |

Consequences:

- **Roadmap is not a Client top-level tab.** A compact Direction summary may be
  read on Overview; Point B, stages, milestones and metrics are operated in
  Roadmap and, for project-scoped milestone work, in the Project workroom under
  Canon 17.
- **Site is not a Client top-level tab.** A website summary may be read on
  Overview; intake, signals and technical site work stay in the Website room.
- **Project-scoped execution is never duplicated into Client.** Work items,
  blockers, delivery, project decisions and project files are operated in the
  Project workroom. Clients shows the project and the door, then stops.
- **Relationship stays read-only**, exactly as Canon 14 fixed it: no reply, no
  send, no second obligation system.
- **Commercial owns the account's human-entered commercial controls**: tier,
  monthly amount, renewal date, next review date, with the existing provenance
  law, plus the roadmap proposal lineage this room already displayed.

### Client Chat

Chat is how a person talks to the account. It reasons; it does not become
truth.

- **Session scoped.** There is no durable client chat store, and none may be
  added without a later canon. What survives a conversation is the client row
  and its activity event, never the transcript.
- **Bounded packet.** Chat reasons over one small composed picture built from
  reads the page already made under the caller's own session: identity and
  commercial state, known people, projects and their state, Direction as
  read-only context, linked sources, what needs attention, recent account
  events. Never a raw Comms message body, never file bytes, never a room that
  failed presented as an absence.
- **No autonomous writes.** The endpoint reads and answers. Nothing is sent,
  replied to, generated, uploaded or published from Chat.
- **Proposals only, through owning services.** A message may prepare one
  bounded proposal: the field, the store that owns it, the value today, the
  value proposed and the person's own reason. A human approves. On approval the
  record is re-read, a proposal prepared against moved truth is refused, an
  already-true value is not written twice, and the write goes through
  `setClientCommercialState`, the same service and refusals as the Commercial
  panel.
- **The bounded set is exactly three fields**: monthly recurring amount,
  renewal date, next review date. **A tier change is not one of them**, because
  a tier move can recognise revenue; it fails closed to the Commercial tab.
- Everything else fails closed by name to its owning room: Projects, Roadmap,
  Comms, Website, Commercial.

`src/domain/client-shell.ts` holds the single tab list, `CLIENT_TABS`.
`src/domain/client-chat-proposal.ts` holds the whole proposal law and
`src/domain/client-context-packet.ts` the whole packet law.

## Canon 19: Milestone success (locked 2026-09-07)

**People describe success. The system structures measurement.**

A milestone is a promise about an outcome, so the everyday path asks a person
only what they can already say out loud.

- **The outcome is the milestone's first fact.** One sentence for what will be
  true, an optional target date, an optional way of checking. It is typed by a
  person, so it is stored as Decided with their name and the moment on it.
  Nothing is inferred and nothing is filled in for them.
- **Acceptance criteria are the working checklist.** Plain conditions in a
  stable order, checked and unchecked by a person, with who completed each one
  and when. A full checklist is evidence that the work is done; it is never a
  reason for the system to complete the milestone. Only a person changes a
  milestone's status.
- **Numeric measurement is advanced, and it is not part of the everyday
  milestone contract (amended 2026-09-07).** The everyday milestone surface, in
  the Roadmap room and in the Client workspace alike, shows only the outcome,
  the target date, the acceptance criteria and the optional success check. It
  never asks for a metric label, unit, baseline, baseline date, target value,
  direction, metric key or readings. `src/domain/milestone-metric.ts`,
  `src/domain/milestone-measurement.ts`, their services, their stored rows and
  `src/components/tt/roadmap/metric-panel.tsx` all remain intact for a future
  advanced surface; none of them is rendered by default.
- **Measurement stays Roadmap's truth** under Canon 17 wherever it is used
  later. Readings are append-only evidence, never mutate baseline or target,
  and any progress line is deterministic from direction plus the reading and is
  labelled as derived.
- **Target date belongs to the outcome**, never to a second numeric form.
- **One implementation.** The Roadmap room and the Project workroom render the
  same Roadmap components and call the same Roadmap service through
  `useMilestoneAcceptance`. There is no second milestone, criteria or
  measurement store.

`src/domain/milestone-success.ts`, `src/domain/milestone-criteria.ts`,
`src/domain/milestone-metric.ts` and `src/domain/milestone-measurement.ts`
hold this law. `docs/milestone-success-criteria-schema.sql` is its canonical
additive schema record.

## Canon 20: The Client Workspace (locked 2026-09-07)

Client is the account shell. Projects and Roadmap remain the truth owners
underneath. **When a person is serving one company, project work and roadmap
execution are operated inside the Client workspace.** The standalone Projects
and Roadmap rooms are portfolio and global views, not required navigation.

This refines Canon 18 without contradicting it. Ownership is unchanged:

- Roadmap owns roadmap direction, milestones, acceptance criteria, metrics and
  measurements.
- Projects owns project state and work execution.
- Comms owns message truth.
- Client is the operating shell and projection for one account.

### What this means in the product

**One workspace, one primary navigation.** The Client page is Home for that
company: Overview · Work · Relationship · Commercial · Files · Chat. There is
no second navigation inside it. The former `Projects` tab is now **Work**.

Work is a single client-scoped operating page:

- a compact project switcher, shown only when the company has more than one
  project; it changes the current work context, it does not navigate;
- the selected project's summary, direction and outcome;
- milestones as the main body, operated through the Roadmap service and the
  same Roadmap components the standalone room renders: add milestone, generate
  candidates, approve/defer/reject, success sentence, target date, acceptance
  criteria, optional measurable target and readings;
- current work, next move, blockers and decisions only when real state exists;
- a compact activity timeline at the foot.

`ProjectWorkroom` renders in two modes. `room` is the standalone Projects page
with its five surfaces. `composed` is the Client workspace: the same component
and the same services, stacked into one page with no tab bar. Files and Chat
are not repeated inside Work: the client-level Files tab is the canonical file
browser, and the client-level Chat is the single AI doorway, which carries the
currently selected project in its context packet.

A person leaves the Client workspace only to change client, or to look across
the portfolio on purpose.

### What it forbids

No second project store, no second milestone store, no second chat truth, no
copy of a workroom surface written for the client shell, and no nested tab bar
inside a client surface. If a surface needs to exist in both places, it is one
component rendered twice.

### Where the state lives

The client route carries `tab` and `project` in its search params, so a
refresh, back/forward and a shared link all land on the same client with the
same current work, inside the same shell.


## Canon 21: Mockup before UI build (locked 2026-09-07)

**Law: for any meaningful UX or UI change, a visual mockup is created and
approved before implementation. The approved mockup is the comparison target
for the build, and the build is reviewed against it before it is called done.**

Exempt: copy fixes, single-value corrections, and bug fixes that do not change
structure, hierarchy or the number of visible controls.

This reconciles into the existing process, it does not start a second roadmap.
The order is: mockup, approval, implementation, verification against the
mockup, then the usual typecheck, lint, tests and build.

### Milestone card shape (approved 2026-09-07)

The milestone card is a detail card, not a control panel.

* Title is prominent. Beside it only the status and the step number.
* The everyday contract is Outcome, Target date, Acceptance criteria, and an
  optional success check. Tier, confidence, priority score and rationale live
  behind "Milestone detail".
* Numeric measurement stays out of the everyday surface entirely. The metric
  and measurement domains remain intact underneath for later use.
* Acceptance criteria are a clean checklist with a quiet inline "Add condition"
  affordance. Ticking every condition is evidence. It never completes the
  milestone; a person still does that.
* One primary action, `Update milestone`. Every lower frequency lifecycle
  action sits in a single quiet overflow, and only transitions valid from the
  current status appear there (`src/domain/milestone-actions.ts`). A chosen
  action is confirmed on the card, with an optional note.
* The section header carries at most `Add milestone`, `Generate candidates`
  and one compact `View` dropdown. No row of filter chips.

## Canon 22: Acceptance evidence (locked 2026-09-07)

**Acceptance Evidence Law:** A checklist box records a human judgment;
evidence records why that judgment can be trusted. Evidence is optional by
default, but may be required for QA, approval, verification, or deliverables
that should be proven. Evidence never auto-completes a criterion or a
milestone. A person remains responsible for checking the criterion and
completing the milestone.

What that means in practice:

- Evidence is Roadmap owned, like the criterion it hangs on (Canon 17). The
  Project workroom and the Client workspace operate it through the same
  Roadmap service. There is no second evidence store and no second file store.
- Three shapes in the first slice: an uploaded file, a link, or a short note.
  Files reuse the existing private `project-files` bucket and its organization
  scoped storage policies. No public bucket is created.
- Optional by default. `evidenceRequired()` in `src/domain/criterion-evidence.ts`
  answers no for every criterion, because no canonical mechanism decides
  otherwise yet. The seam exists so a later rule can answer differently
  without changing what is already written.
- Attaching evidence does not check the criterion. Checking the criterion does
  not require evidence.
- Removing evidence is an explicit act by a person, and it records a receipt
  the same way attaching it does. There is no update path: a stored proof is
  removed and re-attached rather than quietly rewritten.
- Every write carries provenance and a replay key, so a retry is one fact, not
  two.
- Absence is absence. An unreadable evidence table is reported as unreadable,
  never rendered as "nothing attached".

Schema: `docs/criterion-evidence-schema.sql`
(`public.roadmap_criterion_evidence`). Additive and idempotent.
