# Scout → Comms → Roadmap: Relationship Development

A governed relationship-development loop across the three rooms, built on the
existing Scout intel, handoff, and Comms one-relationship architecture. No new
CRM, no send automation, no schema changes (watch state rides on the existing
`prospects.metadata` jsonb via `saveProspectMetadataPatch`).

## New domain contracts — `src/domain/relationship-development.ts`

- `RelationshipOpportunityState`: `ready` ("Ready to consider"), `watching`
  ("Worth watching"), `not_enough_signal`, `not_appropriate` ("Not appropriate now").
- `OpportunityFactor` (key, label, present/absent/unknown, because, weight) —
  eight factors: decision_maker, contact_route, recent_signal, specific_notice,
  contribute_first, natural_bridge, local_relevance, freshness.
- `ChannelRecommendation` for email / linkedin / text, always with a reason.
- `ProofOfCare` (observation | diagnostic | mockup | introduction | resource |
  pattern | idea) — never "lead magnet".
- `RelationshipDevelopmentBrief` — the structured first-move judgment:
  whyNow, humanSignal, whatIsInteresting, whatTaiCanNotice, risksOrAssumptions,
  bestChannel + channelReason, bridgeIdeas, firstMovePosture, shouldActNow,
  evidenceUsed, grounded.
- `RoadmapOpportunitySignal` — revealed-need kinds (competing priorities,
  founder bottleneck, unclear sequencing, growth outpacing systems,
  disconnected tools, unclear next build, repeated symptoms) with evidence,
  because, confidence. A signal, never an auto-conversion.
- `DevelopmentStage` human-facing states: Ready for first move, Waiting for
  reply, Conversation open, Needs Tai, Cooling, Developing.

## New compute layer — `src/data/relationship-development.ts` (pure, tested)

- `relationshipResearchEligible(candidate, people)`: scoreable && score >= 60
  && traceable decision maker. Pure read; eligibility never sends anything.
- `computeRelationshipOpportunity`: deterministic weighted factors, absence is
  unknown never negative. Ready requires decision maker + route + (recent
  signal or specific notice); red fit → not appropriate now.
- `worthKnowingSort`: state rank, then opportunity score — a fresh strong
  signal outranks a stale higher-fit row.
- `recommendChannel`: text only with prior-relationship evidence (never from a
  phone number alone); LinkedIn when the opening signal is LinkedIn-native;
  email default when a business email exists.
- `suggestProofOfCare`: grounded bridge ideas from observed opportunities,
  signals, and industry patterns only.
- `buildRelationshipBrief`: deterministic assembly from stored evidence;
  fail-closed (`grounded: false`, no first move) when there is nothing real to
  notice. `firstMovePosture` encodes soft-introduction doctrine (no forced CTA).
- `detectRoadmapOpportunity(texts)`: deterministic revealed-need detection.
- `readRelationshipDevelopment(metadata)` / watch state reader.

## Comms stage derivation — `src/data/relationship-stage.ts` (pure, tested)

`developmentStage(relationship, touches, now)`: maps the existing one-record
lifecycle to human-facing states. An inbound reply on a reached-out
relationship flips it to "Conversation open" — sequence thinking ends there.
Archived/client relationships return null (graduated, not developing).

## Handoff carry (Phase 5)

- `src/domain/comms-handoff.ts`: optional `development?: HandoffDevelopment`
  (channel + reason, bridge ideas, whyNow) on `HandoffDraft`.
- `src/data/comms-handoff.ts`: `buildHandoffDraft` accepts and attaches it.
- `comms-handoff-receiver.ts`: persists it under
  `metadata.scout_handoff.development` — provenance survives into Comms.
- Reuses the existing governed `routeToComms` path: explicit Tai action only,
  deduped, one canonical relationship (existing `existing()` check).

## Persistence

- `scoutService.setWatch(id, "watching" | "not_now" | null)`: writes
  `metadata.relationship_development` via the existing
  `saveProspectMetadataPatch` + an activity event. No migration needed.

## UI

- Scout: new "Worth knowing" tab (`ScoutTabs` + `section=worth_knowing`) with
  `src/components/tt/scout/worth-knowing.tsx` — calm rows (person + company,
  fit, opportunity state, why now, what caught our attention, best way in, a
  useful bridge, development status), actions See research / Prepare
  introduction / Watch / Not now, truthful pagination via existing `paginate` +
  `ScoutPagination`.
- Prospect detail: new `RelationshipOpportunityCard` on the overview tab —
  state, factors, eligibility line, channel recommendation, bridge ideas, and
  the brief when grounded.
- `HandoffPanel`: shows "Best way in" + "A useful bridge" and attaches the
  development context to the draft. Button copy stays governed.
- Comms: development-stage chip on Nurture inbox rows; "Roadmap opportunity
  emerging" panel beside the existing `SequenceInRoadmap` gate in
  `modules.comms.index.tsx`, stating what was revealed, evidence, why, and
  confidence. Roadmap is still opened only by Tai.

## Tests

`relationship-development.test.ts`: 59% fit ineligible (A); 60%+ with
traceable founder eligible, no side effects (B); high fit without signal stays
Worth watching (C); fresh-signal lower fit outranks stale higher fit (D); no
cold text from a phone number (E); LinkedIn-native opening → LinkedIn (F);
thin evidence → fail-closed brief with no ask posture (J); roadmap signal
needs concrete revealed need, pure function (K).
`relationship-stage.test.ts`: inbound reply → Conversation open (I); one
record through the lifecycle (L).
Handoff receiver test: development provenance survives handoff (H);
duplicate prepare-introduction yields the same relationship (G, existing
dedupe path).

## Docs

Update `docs/scout-v1.md`, `docs/scout-intelligence.md`, `docs/comms-v1.md`,
`docs/architecture-canon.md` with the ownership laws: Scout finds people worth
knowing, Comms develops the relationship, Roadmap is recognized from revealed
need; automation ends where relationship begins.

## Out of scope (labeled, not mocked)

- No background send path, no new Gmail scopes, no LinkedIn scraping.
- Deeper-research automation reuses existing Scout research runs; where a live
  source is unavailable the UI labels the capability rather than faking it.
