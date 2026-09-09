# Cross-room Intelligence Layer audit — Conductor, Steward, Comms, Pulse, Studio

Audit only. No implementation, no percentage changes, no Studio expansion.

## The headline finding

The shared retrieval bundle exists and is well built, and **nothing in production
uses it**. `composeRetrieval()` (`src/data/intelligence/runtime/retrieval.ts:86`)
has zero production callers; `reasonWithRuntime()`
(`src/lib/intelligence-runtime.server.ts:244`) has one caller, the generic
endpoint `src/routes/api/public/intelligence.reason.ts:57`, and that one uses
`reasonOverPacket`, not the bundle.

Every reasoning room instead calls `runtimeModelCaller` with a hand-written
prompt: `comms-draft.server.ts:642`, `steward.interpret.ts:255`,
`content-engine.server.ts:378`, `scout-discover.server.ts:140`,
`scout-import.server.ts:122`, `client-intelligence.server.ts:108,209`,
`project-intelligence.server.ts:111,258`, `roadmap-intelligence.server.ts:153,283`,
`roadmap-studio.server.ts:231`.

So Law 3 (reason through the shared retrieval bundle) is currently satisfied by
**no room**. The transport boundary is clean and CI-guarded
(`intelligence-runtime-boundary.ts`, `REASONING_EXCEPTIONS` empty) — the gap is
retrieval, not transport. That is the single most valuable correction available.

## Room findings

### Conductor — coordination, zero model calls
Owns no entity; writes only `business_intents`, figures, corrections
(`src/data/supabase/conductor-service.ts:1-12`). Reads every room through its own
service (`src/data/conductor/adapters.ts:13-18`) and verifies outcomes by
re-reading the owning room (`outcome-observer.ts:45-158`). Truth precedence is
formal and correct (`src/domain/outcomes.ts:34-51`), contradiction is recorded not
resolved (`learning.ts:207-211`), observations are idempotent by content
(`outcomes.ts:244-271`), corrections outrank inference (`learning.ts:113-149`).
This is the strongest room in the suite for Laws 4, 5, 8, 9, 10.

Gap (high-value, not correctness): it makes **no model calls at all**
(`answer.ts:1-11`) while performing interpretive work in regex and constants —
`TOPIC_RULES` (`answer.ts:73-152`), `DEMAND_PATTERNS` (`:169-177`),
`DESTINATION_PATTERNS` and `STATE_RANK`/`TIER_RANK`
(`roadmap-cycle.ts:86-114`), question-similarity by word overlap
(`roadmap-cycle.ts:457-481`), blind-spot cutoffs (`blindspots.ts:40-175`),
magic `3` inlined instead of `FRICTION_THRESHOLD` (`answer.ts:391-393`).
Also: `roadmap-cycle.ts:236-316` independently ranks which milestone deserves
attention rather than calling a Roadmap-owned function — a genuine Law 2
contradiction surface with the Roadmap room.

### Steward — interpretation, compliant, one identity gap
One model call, through the boundary (`steward-interpret.server.ts:149-205` via
`steward.interpret.ts:255`). Regex candidate detection (`extract.ts:183-297`) is
legitimate triage: meaning always goes to the model or to a person. Corrections
are stored as `decided/human` ledger rows and genuinely consumed later
(`learning.ts:84-174`, `judgment.ts:122-139`, `memory-context.ts:148-150,257-318`,
dismissal suppression `learning.ts:484-494`). Failure is honest — it throws
rather than promoting regex output (`steward-interpret.server.ts:140-142,172-185`).

Correctness flaw: Steward keeps its own person registry `steward_role_memory`
(`steward-service.ts:317-363`, read at `steward.interpret.ts:139-142`) and reads
no `profiles`, `contacts` or `clients` at all. That breaks Law 1 and Law 2 — the
same failure class just fixed in Scout.

### Comms — compliant reasoning, correct policing
Two-pass model call through the boundary (`comms-draft.server.ts:640-660`), with
the ask-gate enforced in code over model output
(`comms-judgment.ts:204-217`, enforced `comms-draft.server.ts:746-771`) — a good
example of Law 7. Tiers never blended; inferred facts excluded from assertion
(`comms-draft.server.ts:378-382`). Failure is typed and honest (`:83-97`).
Canonical `contacts`/`clients` reuse is real (`comms-intake.server.ts:53-98`,
`comms-context.server.ts:96-101`). Edge functions make no model calls.
Gap: no room-level feedback loop — a rejected or rewritten draft teaches nothing.

### Pulse — visibility, no model, feedback loop works
No model calls anywhere. Deterministic projection with thresholds
(`data/pulse/projection.ts:97-112`), suppression from human feedback that is
stored and re-read every render (`pulse-feedback.ts:64-77`,
`projection.ts:138-154`). Owns nothing, copies nothing (`handoff.ts:77-86`).
Gap: Pulse's `severityOf` thresholds and Conductor's patternKey narrative
(`conductor/answer.ts:338-363`) interpret the same `derive.ts` signal
independently — two maintained lists, one truth. Law 2 risk, no test asserts
they agree.

### Studio — audit only, mark later
Blog engine calls the boundary correctly (`content-engine.server.ts:378`,
plan + per-post calls `:219-232`, `:303-317`), hand-built prompts, no retrieval
bundle. Image generation is an honest stub (`content-image.server.ts:35,76-81`).
Publishing is real with an append-only attempt ledger and readback verification
(`content-publish.server.ts:163-183,471-517`). Naming collision to resolve later:
the manifest's `"studio"` entry (`manifest.ts:326-352`) describes Roadmap's
artifact composer, not this room, so the blog engine's readiness is undeclared.

## Correctness flaws vs intelligence gaps

Correctness (bounded fixes, no mockup):
1. Steward reads no canonical person truth — extend the Scout resolver path.
2. Conductor re-derives Roadmap milestone attention — call the Roadmap-owned read.
3. Pulse/Conductor duplicate severity interpretation — one shared projection + a test.
4. Studio manifest entry describes the wrong room.
5. `FRICTION_THRESHOLD` inlined as a literal in Conductor prose.

Intelligence gaps (bigger, sequenced after):
6. No room composes a retrieval bundle: no canon, prior cases or corrections
   reach any prompt except Steward's own hand-rolled memory selection.
7. Conductor interprets natural language with regex where the model belongs.
8. Comms learns nothing from accepted/edited drafts.

## The cross-room architecture plan

**A. Shared Intelligence Read contract.** One new pure contract,
`src/domain/intelligence-read.ts`: `IntelligenceRead` = subject ref, evidence
with tiers, conflicts, interpretation, unknowns, next steps, confidence,
provenance. Produced once per subject by a room-supplied composer over
`composeRetrieval()`. No new table, no new store: the read is composed at request
time from the owning rooms' services, exactly as `SuiteSnapshot` already is.

**B. Ownership unchanged.** Rooms still own writes. The read is a projection, and
every action it suggests still routes through the owning room's service and human
gate, as `src/data/conductor/adapters.ts` already enforces.

**C. Governance vs interpretation.** Governance stays code: access and RLS,
thresholds that define policy, idempotency, ask-gate, precedence ordering,
observed-only movement, verification. Interpretation moves to the model: topic
and intent classification, "same question", destination detection, blind-spot
naming, conflict explanation. Any deterministic path that ships in place of a
model result must carry a `deterministic: true` label all the way to the surface
(Law 6) — the pattern already proven in Smart Import's `providerAnswered`.

**D. What enters the packet.** `composeRetrieval()` already takes evidence,
decided statements, canon observations, prior cases, corrections, capabilities
and a context packet. Each room supplies: its own state, canonical identity from
Core, the shared signal derivation, canon matches, prior cases for those matches,
and human corrections first. Nothing else reaches the model.

**E. One read, many projections.** A subject is read once per request and every
surface renders that read. Pulse, Conductor narrative and the room's own page
stop each computing severity and wording. Adding a surface means adding a
projection, never a second interpretation.

**F. Conflict precedence.** `TRUTH_RANK` in `src/domain/outcomes.ts:34-51`
becomes the suite-wide rule: decided > observed > inferred > recommended >
unknown, newer beats older within a tier, and every superseded claim stays
visible as a named conflict on the read. Nothing is silently dropped.

**G. Feedback loops.** Three existing ledgers, no new store: Steward's belief
ledger, Conductor's learning ledger, Pulse feedback. Rooms without one write
their corrections as `decided` cases into the canon case ledger so
`composeRetrieval` surfaces them first on the next read.

**H. Bounded vs mockup.** Bounded: items 1–5 above, plus wiring retrieval into
existing prompts (no visible change). Mockup required (Canon 21/23): showing
conflicts on a room surface, any "why we think this" disclosure, Conductor
answers gaining model phrasing, and any Comms draft-feedback control.

## Canon wording to add (Canon 27, draft)

> **Canon 27: One read per subject (proposed).** Every room reasons through
> `composeRetrieval()`; a hand-built prompt without a retrieval bundle is a
> bypass. A subject is read once per request and projected into every surface;
> no surface re-ranks or re-words a read it did not compose. Precedence is
> decided > observed > inferred > recommended > unknown, and a losing claim is
> shown as a conflict, never dropped. Deterministic output shipped in place of a
> model result says so on the surface. Corrections enter the next read first and
> permanently. Interpretation goes to the model; governance stays code.

## Execution sequence (no percentages change)

1. Steward canonical identity resolution (correctness, reuses Scout's resolver).
2. Conductor → Roadmap-owned milestone attention; delete the local re-derivation.
3. One shared severity/impact projection for Pulse + Conductor, with a test.
4. Studio manifest correction and `FRICTION_THRESHOLD` cleanup.
5. Retrieval wiring, one room at a time, behind unchanged output: Comms draft →
   Steward interpret → Scout → Studio.
6. `IntelligenceRead` contract + one pilot room projection.
7. Mockups: conflict surface, "why we think this", Conductor model phrasing.
8. Feedback loops for Comms and Scout.
9. Studio expansion — later, after 1–8.
