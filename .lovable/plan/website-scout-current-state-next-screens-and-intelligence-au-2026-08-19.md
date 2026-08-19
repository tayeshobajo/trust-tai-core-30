# Website → Scout: current state, next screens, and intelligence audit

Audit only. No code changed. Every claim below was verified against files in this repo.

## A. Current Website → Scout backend state

Working today:

- `docs/website-signals-schema.sql` defines `website_intake_submissions` and `website_events`, org-scoped, RLS member-read, service-role write. Applied in production.
- `src/lib/website-intake.server.ts` receives signed intake: HMAC-SHA256 over `${timestamp}.${rawBody}`, 300s skew, org from server env (never payload), idempotent on `submission_id`, evidence-based prospect match (`src/domain/website-matching.ts`), link or hold, one `activities` row.
- Prospects created by intake carry `source: 'website_roadmap_intake'` and a rich `provenance` object (submission id, landing path, utm, label).
- Read side: `src/data/supabase/website-service.ts` plus pure projections in `src/data/website/projection.ts` (null, never fabricated 0).
- Website room `src/routes/modules.website.tsx`: Attention / Funnel / Submissions / Sources tabs, inline expanding submission rows.
- Scout prospect detail renders `InboundSourceCard` (`src/components/tt/scout/inbound-source.tsx`) — small, easy to miss.

Gaps in the backend chain:

1. No addressable submission route. Submissions are only expandable rows in a tab; nothing can be linked to from Scout, Pulse, or an email.
2. Intake writes `activities` directly with `event_type: 'website.handed_over' | 'website.flagged'`. `website` is not a valid `ActivityScope` in `src/domain/activity.ts` and `website` is not a `SuiteAppId` in `src/domain/events.ts`. The rows exist but are outside the promised suite vocabulary, so no reader is obliged to understand them.
3. Prospect `observed / inferred / suggested` are written as empty by intake. The Founder Signal Packet (verbatim, structured, signals) stays only in `website_intake_submissions`; Scout's own evidence model never receives it.
4. `CandidateSourceKind` in `src/domain/scout.ts` is `preview_demo | live_website` only. An inbound company is displayed as if Scout sourced it.
5. `signals.frame`, `frame_confidence`, `objective_coverage`, `completeness`, `authorizes_research` are stored and partially shown, but nothing consumes them for ranking, routing, or attention.
6. Confirmed reflection, understanding confidence, and intent do not exist in Core schema or UI. Stated / Observed / Inferred / Suggested exists as columns on `prospects` and as `ConfidenceRead` in `src/domain/confidence.ts`, but there is no `stated` lane for founder-supplied truth.

## B. Next four screens to design

1. **Website Submission Detail** — `/modules/website/submissions/$submissionId`
   Purpose: the source record, permanently linkable. Composition: identity header (company, person, submitted at, ambient wash from the company accent when known); Founder Signal Packet as four blocks (Point A / Point B / Pains and constraints / Open questions); verbatim conversation transcript with modality and skipped markers; attribution rail (landing path, utm, session, pages before start, device); resolution panel showing link state, link reason, and either the linked prospect or a "Link to a company" decision; consent and privacy footer.

2. **Scout Prospect Detail — Inbound variant** — existing `/modules/scout/prospects/$prospectId`
   Purpose: make origin the first thing Tai reads. Composition: origin rail above the existing hero, replacing today's buried card; "What they told us" panel (stated) sitting beside "What we observed" (research), visually separated; a single next move; link back to the submission.

3. **Scout Research Workspace** — a tab or right pane on prospect detail
   Purpose: turn a stated intake into evidence. Composition: coverage strip of what has and has not been checked; a run-research action gated by `signals.authorizes_research`; per-claim rows carrying Stated / Observed / Inferred / Suggested and confidence with evidence links; conflict banner where research contradicts what the founder stated.

4. **Tai Decision State** — decision panel on prospect detail, mirrored in Pulse
   Purpose: one bounded decision with a named consequence. Composition: recommendation with its because; Qualify / Pass / Hold with what each triggers; the owner and the deadline; the resulting activity written back to the stream.

## C. Website-origin visual language

- **Origin rail, not a loud banner.** A 2px royal left rule on the prospect card and detail hero, plus a top Ambient Identity Wash (6% mix, fading by ~180px) using the company's real accent when recorded, otherwise royal.
- **Badge:** mono eyebrow `INBOUND · TRUSTTAI.COM`, ink text on `--tt-secondary`, pill, with a small Lucide `globe` glyph. Never colour alone: the words carry the meaning.
- **List treatment:** inbound rows in Scout show the badge plus "Told us: <first desired future>" as the secondary line, so origin and substance arrive together.
- **Rail:** on detail, a persistent right-hand "Source" block: submission date, campaign, completeness, and a link to the submission detail.
- Restraint rule: one atmospheric region per page, badge in at most two places, no tinted cards, no glow.

## D. Intelligence layer audit by app

- **Website — PARTIAL.** Owns state, persists provenance, writes history. But its events are outside `SUITE_EVENTS`/`ActivityScope`, and no other room reads `website_events`.
- **Scout — PARTIAL.** Full suite vocabulary and evidence model, but inbound origin is not part of `CandidateSource`, and stated founder truth is not in its evidence lanes.
- **Comms — CURRENT.** Emits four suite events, consumed by derive, Pulse and Steward.
- **Roadmap — CURRENT.** Four suite events including decision requested/resolved.
- **Projects — CURRENT.** Lifecycle plus routing events, read by Pulse and the engine.
- **Ops — CURRENT** for accept/start/complete; projection-backed.
- **Studio — PARTIAL.** Events defined in `SUITE_EVENTS`, but no room in Core emits them yet.
- **Pulse — PARTIAL.** `src/data/pulse/projection.ts` labels and verbs exist for scout, comms, roadmap, projects, ops; nothing for website, so inbound signals cannot reach attention levels.
- **Steward — PARTIAL.** Interprets meetings, commitments, beliefs; does not read intake conversation text, which is the richest first-person source in the suite.
- **Conductor — PARTIAL.** Adapters cover Scout, Roadmap, Comms, Projects. No website-origin awareness in payload auto-fill, so an inbound cycle cannot be started from a submission.

## E. New intake changes vs the contract

Already represented: verbatim answers with modality, structured eight-field extraction, attribution and utm, consent, completeness and coverage scalars, idempotency, the event vocabulary for the shorter adaptive flow (`intake_answered`, `intake_resume_requested`, `intake_abandoned`).

Not represented: grounded reflection (the confirmed summary the founder agreed to), understanding confidence as a first-class lane, declared intent, a `stated` provenance kind next to observed/inferred/suggested, per-answer confidence, and any consumer of `authorizes_research` as a permission gate.

## F. Top gaps to close

1. `website` is not a suite event emitter — add the scope and a small vocabulary (`website.intake_received`, `website.intake_linked`, `website.intake_held`).
2. Founder Signal Packet never reaches Scout's evidence lanes; add a `stated` lane.
3. No addressable submission detail route.
4. Inbound origin invisible in Scout list and weak on detail.
5. Pulse blind to inbound: an unlinked or unreviewed submission raises nothing.
6. Reflection, understanding confidence and intent are conceptual only.
7. `authorizes_research` is stored but not enforced anywhere.
8. Studio emits nothing; Steward ignores intake language.

## G. Recommended implementation order

1. Contract first: `website` scope and suite events, `stated` lane, `CandidateSource` inbound kind.
2. Backfill mapping so intake fills `prospects.observed/inferred/suggested` (stated) from the Founder Signal Packet.
3. Website Submission Detail route.
4. Scout inbound visual language: badge, rail, wash, list line.
5. Scout Research Workspace with Stated vs Observed and the research authorisation gate.
6. Tai Decision State panel and its write-back.
7. Pulse inbound signals and Conductor website-origin payload auto-fill.
8. Reflection / understanding confidence / intent as schema plus UI, once the website side emits them.
9. Steward reading intake language; Studio emission last.
