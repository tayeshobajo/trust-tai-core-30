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
