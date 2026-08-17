# Roadmap inner page — the strategic working room for one company

Rebuild `/modules/roadmap/$roadmapId` as the single working room for one company's path: where they are, where we are taking them, the milestone sequence, the proof, the open decisions, the client copy, and the handoff into execution. Visual source of truth is the attached mockup; language and tokens stay the existing Cloud Blue system.

## What the page becomes

Six tabs, each with one job.

- **Overview** — company header, roadmap summary (Point A → Point B + progress), milestone path, current milestone, anchor proof, key decisions. Right rail: Actions, Client copy, Next attention, Notes.
- **Milestones** — the sequence, refined. Each milestone shows number, name, status, truth tier, owner, what it builds, what it unlocks, dependencies, evidence and decision counts. Build roadmap opens a focused editing mode in place, not a second product.
- **Evidence** — anchor proof, then evidence grouped by what it supports (Point A, Point B, milestone), each with source, observed date, tier, confidence.
- **Decisions** — Open / Answered / Superseded. Question, why it matters, what it blocks, owner, requested date, answer. Human answers only; nothing auto-resolves.
- **Exports** — versioned client copies: version, created date, created by, latest flag, shared/sent state. Create, preview, download, send via Comms.
- **Activity** — roadmap history read from the existing shared activity stream. No second ledger.

The seven current sections (Command centre, Research, Strategy, Milestones, Studio, Walkthrough, Build order) collapse into these six. Research and Strategy become Evidence content; Studio and Walkthrough become the export/client-copy path; Build order becomes the Projects & Ops handoff.

## Milestone path

`roadmap_milestones` (Roadmap Intelligence v2) drives the numbered path, ordered by recommended sequence. Status colour: green complete, blue in progress, neutral not started, orange blocked or waiting on a decision. `roadmap_stages` stays readable where it already holds data but is no longer the page's spine.

Progress is supporting context only — "33%, 2 of 6 milestones in progress" — never louder than the sequence.

## Lifecycle actions (right rail)

1. **Build roadmap** — refine direction and milestones (editing mode).
2. **Export roadmap (client copy)** — snapshot approved state into a new version.
3. **Send to client (Comms)** — routes into Comms with company, contact, export and suggested subject/message. Roadmap never sends.
4. **Handoff to Projects & Ops** — a confirmation screen listing approved milestones with a recommended owning room; the person approves before anything is created.

Client-copy status stays visible but quiet everywhere: Not exported / Draft / Latest / Sent / Outdated. When the roadmap changed after the latest export, show "Client copy outdated" with "Create updated version". Existing exports are never mutated.

## Backend

Existing and reused: `roadmaps`, `roadmap_milestones`, `roadmap_stages`, `roadmap_decisions`, `roadmap_research`, `roadmap_strategies`, `roadmap_artifacts`, `roadmap_artifact_versions`, `activities`, `clients` / `prospects` for company identity, `projects` for execution.

Two new tables, delivered as one migration file in `docs/roadmap-exports-schema.sql` for you to apply to the shared backend (I cannot apply it myself):

- `roadmap_exports` — id, organization_id, roadmap_id, version, status, snapshot (jsonb, frozen), created_by, created_at, sent_at, comms_relationship_id, comms_message_id.
- `roadmap_execution_links` — id, organization_id, roadmap_id, milestone_id, owning_app, project_id, ops_reference, status, created_at. Correlation only; Projects and Ops keep owning their own state.
- `roadmap_notes` — id, organization_id, roadmap_id, body, author, created_at (for the Notes card).

Each table gets grants for `authenticated` and `service_role`, RLS on, and org-scoped policies reusing `private.is_org_member`, matching the existing roadmap tables. Until the migration is applied, the Exports tab and Notes card show a clear "not yet available" state rather than failing.

Export snapshots exclude internal notes, private reasoning, internal scores, AI confidence and governance metadata. Unapproved Point B is only included when explicitly labelled a proposal.

## Components

New folder `src/components/tt/roadmap/detail/`: `company-header`, `summary` (Point A → Point B + progress), `milestone-path`, `current-milestone`, `anchor-proof`, `decision-list`, `actions-card`, `client-copy-card`, `next-attention-card`, `notes-card`, `milestone-editor`, `evidence-list`, `decision-manager`, `export-list`, `activity-list`, `execution-handoff`. The route file composes them and owns data fetching only.

Deterministic read models live in `src/data/roadmap/detail/`: milestone path projection, progress, anchor proof selection, next-attention resolution (one or two items, never a wall of alerts), export freshness, and handoff readiness — each unit tested.

## Truth and authority

- Inferred Point B renders as **Proposed**, never as decided truth.
- Anchor proof comes from stored evidence with a real source; nothing is fabricated. No evidence means an honest empty state.
- Decisions are answered by people only.
- Handoff to execution requires explicit human approval and only offers approved milestones.
- Existing permissions and cross-org isolation are untouched; no authority is widened for convenience.

## Responsive

Desktop first at 1440px. At medium widths the right rail moves beneath Overview. At 375px the header stacks, the milestone path scrolls horizontally within its own container, and tabs stay reachable. No page-level horizontal overflow.

## Verification

Typecheck plus the full test suite, new unit tests for each read model, and a signed-in Playwright pass at 375 / 768 / 1440 against a real roadmap to confirm the six tabs, the lifecycle actions, and the empty states behave.
