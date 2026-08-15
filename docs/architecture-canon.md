# Trust Tai OS — architecture canon

The source of truth for any future work in this codebase, human or AI. Short on purpose.
If a change contradicts this document, the change is wrong until this document is changed
deliberately.

**The law**

> Apps own state. Core owns identity. The event stream owns history.
> Steward owns interpretation. Pulse owns visibility.

**Operating principle: small input, deep intelligence, clear output.**

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

- **Scout** — prospects, fit evidence, discovery of companies and decision-makers.
- **Comms** — relationships, conversations, threads, replies, promises to people.
- **Roadmap** — Point A → Point B strategy, milestones, sequencing, roadmap decisions.
- **Projects** — execution, ownership, delivery state, blockers.
- **Ops** — websites, technical health, maintenance (external app, SSO room in shell).
- **Studio** — content and produced assets.

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
milestones only).

Cross-app moments are emitted once, by the owning room, in the shared vocabulary
of `src/domain/events.ts` via `emitSuiteEvent`. Room-local history stays a plain
activity. Steward and Pulse read this stream; they never write to it.
