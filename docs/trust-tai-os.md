# Trust Tai OS Foundation — product contract

Trust Tai OS is the shared shell and shared contract that every internal Trust Tai app
inherits. It is not a business app. Its job is to make future apps interoperable by
default.

**Operating principle: small input, deep intelligence, clear output.**

## 1. One identity

A person signs in once as a Trust Tai user. Apps never manage their own accounts.
The boundary lives in `src/lib/auth-boundary.ts` and **fails closed**: with no identity
provider configured, production renders a locked configuration state
(`LockedWorkspace`) instead of a usable workspace. There is no demo access in
production; a shell preview is available only in development builds.

## 2. One organization model

Everything hangs off an `Organization`. Every shared entity carries `organizationId`
in its envelope (`BaseEntity`). There is no per-app tenancy.

## 3. Shared core entities (`src/domain/entities.ts`)

`Organization`, `User`, `Client`, `Contact`, `Project`, `Website`, `Conversation`,
`Task`, `Decision` — plus `EntityRef` for cross-app pointers and `LifecycleStatus`
for the canonical states (Mapped, In build, Live, Needs decision, At risk, Blocked,
Unknown).

**Rule: apps share data, they do not duplicate entities.** If Comms needs a client, it
reads `Client`. It does not create `comms_client`. New app-specific detail attaches to
a core entity by id rather than copying it.

## 4. App registry (`src/domain/registry.ts`)

Each app is registered once with `id, name, slug, description, status, route, icon,
capabilities`. Navigation, the suite list on Home, and future permission checks all
read this single list. Adding an app means adding a registration, not editing the shell.

## 5. Activity contract (`src/domain/activity.ts`)

Every app writes the same event: `entity.action` (e.g. `project.status_changed`), a
subject `EntityRef`, optional related refs, a plain-language summary, and
`Provenance` (which app, which actor — user / system / intelligence — when observed,
and whether the value was observed or inferred).

This is a contract, not a message bus. Today it is a typed interface with an in-memory
implementation; later it becomes one shared table.

## 6. Intelligence context contract (`src/domain/intelligence.ts`)

`IntelligenceProvider.retrieve(ContextRequest) → ContextResult` returns `ContextFact`s
that always carry provenance and are labelled `fact | inference | recommendation`, so
an AI suggestion is never mistaken for an approved human decision. Retrieval is
authorised per user and per app, and reports what was **withheld** and why. The current
implementation is mocked; no live orchestration exists yet.

## 7. Persistence boundary (`src/data/`)

`TrustTaiDataSource` in `repositories.ts` defines the narrow read/write surface.
`memory-source.ts` is a reference in-memory implementation used for the development
preview. Connecting a shared Supabase backend means writing a second implementation of
the same interface — no product-shell rewrite.

## 8. Design system

Trust Tai tokens live in `src/styles.css` (ink, paper, royal, rule, status colours;
Cormorant Garamond / Inter / JetBrains Mono). Shared components live in
`src/components/tt/`: buttons, inputs and fields, status pills, cards, page headers,
section headings, empty states, decision cards, context panels, and the app shell with
its suite navigation. Royal blue is a signal, never wallpaper. Status is never
communicated by colour alone.

## Deliberately deferred

- No backend, no real auth, no live AI orchestration.
- No Scout, Comms, Roadmap, Projects, Studio, or Pulse implementations.
- No message bus, no microservices, no permission matrix beyond the typed shape.
- No settings, KPI dashboards, or charts.
