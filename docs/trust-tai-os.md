# Trust Tai OS, architecture contract for the live suite

Trust Tai OS is the shared shell and shared contract that every internal Trust Tai app
inherits. It is not a business app. Its job is to make the apps interoperable by default.

**Operating principle: small input, deep intelligence, clear output.**

**The law**

> Apps own state. Core owns identity. The event stream owns history.
> Steward owns interpretation. Pulse owns visibility.

The enforceable short form of this document is `docs/architecture-canon.md`.

## 1. One identity

A person signs in once as a Trust Tai user through Supabase Auth. Apps never manage their
own accounts. The boundary **fails closed**: workspace data is available only after an
active `organization_memberships` row is verified (`src/components/tt/workspace-gate.tsx`,
`src/lib/workspace.tsx`). Membership is never silently created and there is no demo access.

## 2. One organization model

Everything hangs off an `Organization`. Every shared entity carries `organizationId` in its
envelope (`BaseEntity`). There is no per-app tenancy. `src/domain/access.ts` gives every app
one typed way to ask "may this person do this here?", a typed mirror of RLS, never a
replacement for it.

## 3. Shared core entities (`src/domain/entities.ts`)

`Organization`, `User`, `Client`, `Contact`, `Prospect`, `Project`, `Website`,
`Conversation`, `Task`, `Decision`, plus `EntityRef` for cross-app pointers and
`LifecycleStatus` for the canonical states.

**Rule: apps share data, they do not duplicate entities.** If Comms needs a client, it reads
`Client`. It does not create `comms_client`. New app-specific detail attaches to a core
entity by id rather than copying it. There is no parallel state store per module.

## 4. The suite model (`src/domain/registry.ts`)

Each app is registered once with `id, name, slug, description, status, layer, route, icon,
capabilities`. Navigation, the suite list on Home, and entitlement checks read this single
list. `layer` records the architectural position:

- **core**. Home: the shell, identity, shared entities.
- **business**. Scout, Comms, Roadmap, Projects, Ops, Studio: they own domain state.
- **stewardship**. Steward: interpretation, memory, judgment, recommendation, routing.
- **intelligence**. Pulse: the suite-wide visibility and readout surface.

Ownership boundaries: Scout owns prospects and fit evidence; Comms owns relationships,
threads and promises; Roadmap owns strategy, milestones and sequencing; Projects owns
execution and delivery state; Ops owns websites and technical health (external app, room in
the shell); Studio owns produced content.

## 5. Activity contract (`src/domain/activity.ts`, `src/domain/events.ts`)

Every app writes the same event: `entity.action` (e.g. `project.blocked`), a subject
`EntityRef`, optional related refs, a plain-language summary, and `Provenance` (which app,
which actor, user / system / intelligence, when observed, and whether the value was
observed or inferred).

One stream, `public.activities`, written through `emitSuiteEvent`. Only the room that owns
the state emits the event about it. Pulse and Steward read this vocabulary; they never
author it. It is history, not a message bus.

## 6. Intelligence and stewardship

`IntelligenceProvider.retrieve(ContextRequest) → ContextResult` returns `ContextFact`s that
always carry provenance and are labelled `fact | inference | recommendation`, so an AI
suggestion is never mistaken for an approved human decision. Retrieval is authorised per
user and per app and reports what was **withheld** and why.

The live engine (`src/data/intelligence/engine/`, documented in
`docs/intelligence-engine.md`) reads broadly with provenance across every room, proposes
**bounded** actions with `willDo` / `willNotDo`, and routes execution to the owning room.
It owns no business entity and never silently executes. Authorisation is role-bound
(`src/domain/action-authority.ts`) and re-checked server-side.

Steward is the stewardship layer of that same intelligence: interpretation of conversations,
person-centred memory and beliefs, judgment about what deserves attention, and routing. It
keeps its UI at `/modules/steward`, but it does not own conversations, tasks, decisions,
project risk or client risk, those stay with their owning modules and core entities.

## 7. Persistence boundary (`src/data/`)

`TrustTaiDataSource` in `repositories.ts` defines the narrow read/write surface;
`src/data/supabase/*` implements it against the shared external Supabase project.
`memory-source.ts` remains a reference in-memory implementation for tests and development.

## 8. Design system

Trust Tai tokens live in `src/styles.css` (ink, paper, royal, rule, status colours;
Cormorant Garamond / Inter / JetBrains Mono). Shared components live in
`src/components/tt/`. Royal blue is a signal, never wallpaper. Status is never communicated
by colour alone. The experience layer is documented in `docs/experience-system.md`.

## 9. What is built

Live rooms: Home, Scout (`docs/scout-v1.md`), Comms (`docs/comms-v1.md`), Roadmap
(`docs/roadmap-v1.md`), Projects (`docs/projects-v1.md`), Ops integration
(`docs/ops-integration-v1.md`), Steward (`docs/steward-v1-schema.sql`,
`docs/steward-judgment.md`), Pulse, and the Intelligence Engine
(`docs/intelligence-engine.md`).

## Deliberately deferred

- Studio implementation.
- Any message bus, microservice split, or second event store: one codebase, modular
  monolith first.
- Any path by which intelligence executes work without a person authorising it.
