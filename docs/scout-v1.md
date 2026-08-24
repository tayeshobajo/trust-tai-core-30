# Scout v1

## Point A

Trust Tai finds prospective clients by memory, referral, and ad-hoc browsing.
Nothing is written down in a shared place, and nobody can say why a company was
considered a fit or who is carrying it next.

## Destination

A calm room where a plain-English description of an ideal client returns a small
set of companies, each with the evidence behind it, and one clear action.

## Primary loop

1. Describe who we are looking for in one input.
2. Scout returns a small set of candidates from the preview demo set.
3. Each candidate shows observed signals, an inferred fit reason, and a
   recommendation — labelled separately.
4. Qualify or Pass. Qualifying moves the prospect to **Ready for Comms** and
   writes a local activity event.

Small input. Deep intelligence. Clear output.

## Shared vs Scout-specific data

- **Shared** (`src/domain/entities.ts`): `Prospect` — id, organization, name,
  domain, status, optional steward and timestamps. `EntityType` gained
  `"prospect"` so activity events and future Comms can reference the same row.
- **Scout-specific** (`src/domain/scout.ts`): `ScoutSignal`, `ScoutFit`,
  `ProspectCandidate`, `ScoutProvider`. Fit evidence never enters the core model.

Persistence stays behind `TrustTaiDataSource`. Scout reads and writes through
`source.scout`, so a Supabase-backed implementation can replace the in-memory
one without touching the UI.

## What is mocked

Everything that would require a backend or an external source:

- The candidate set is a fixed in-memory list in `src/data/scout-source.ts`.
  It is labelled **Preview demo source** in the UI.
- No internet, LinkedIn, Apollo, Clay, or AI call is made. The query only
  filters and orders the demo set.
- Status changes live in memory for the session and are lost on reload.
- Fit reasons and recommendations are authored, not generated. They are labelled
  as inferred and recommended, never as observed.

## Handoff contract to future Comms

A qualified prospect emits an activity event:

```
name:    "prospect.status_changed"
subject: { type: "prospect", id, label: company name }
summary: "<Company> is qualified and ready for Comms."
```

Comms will read prospects with `status: "qualified"` from the same repository
boundary and open a conversation against the same prospect id. No prospect
record is duplicated.

## Not in v1

No filters, no CRM dashboard, no settings, no scores, no enrichment, no
outreach. Ops, Comms, Roadmap, Projects, Studio, and Pulse are untouched.

## Update — Supabase-backed Scout

Scout no longer keeps state in memory.

- **Access.** Real Supabase Auth (email one-time link at `/auth`). `WorkspaceGate`
  renders nothing of the workspace until an active `organization_memberships`
  row is read back through RLS. Authenticated-but-unprovisioned accounts see a
  calm "Access not provisioned" state; membership is never created here.
- **Prospects.** Preview candidates are written to `prospects` with
  `source = scout_preview_demo` and provenance recording the active ICP version.
  Qualify moves the row to `ready_for_comms`, Pass to `passed`. Both append an
  `activities` row (`app_key: scout`, `prospect.status_changed`). State survives
  reloads.
- **ICP.** `icp_profiles` holds one organization-level row. Scout reads it as its
  targeting source of truth and shows `Using ICP v{n}`. `/modules/scout/settings`
  previews the saved Markdown, and owner/admin members can edit or stage a
  `.md`/`.txt` upload before an explicit save (which increments `version` and
  sets `updated_by`).
- **Still mocked.** Sourcing and scoring. No internet, LinkedIn, Apollo, Clay, or
  AI is contacted; the domain layer is shaped so a real sourcer can consume the
  same ICP without a redesign.

## Live website research (transitional v1)

Scout's single input now routes automatically:

- **Plain-English sentence** → preview discovery against the fixed in-memory
  candidate pool, still labelled `Preview discovery. No external company search yet.`
- **URL / domain** → real research via the managed `scout-research` Edge Function,
  labelled `Live public website research.`

Live research reads **public website pages only**. There is no search-engine
discovery, no LinkedIn/Apollo/Clay, and no private data. Inference is
deterministic heuristic analysis, not AI scoring.

Persistence (`prospects`): `source = scout_live_website`, first save
`status = discovered`, `observed` / `inferred` / `suggested` / `provenance`
taken from the function response, provenance extended with the active ICP
version and the researching user, `created_by` = signed-in user. An existing
prospect for the same normalized website is refreshed in place, never duplicated.

Each successful run appends a `prospect.researched` activity (`app_key = scout`)
with source, page count, website, and ICP version.

## Scouting board (v1.1)

Scout is now a board, not a feed.

- **Local nav:** Scout (working board) · Qualified · Research (history) · ICP Settings.
- **Default view:** a compact list — fit light, company, ICP match %, strongest
  signal, workflow stage, last checked. Sorted by fit light, then score, then
  recency. Filters: All / Green / Yellow / Red.
- **Detail drawer:** opens on row click with the fit read, score breakdown by
  criterion, observed evidence with source links, inferred interpretation,
  suggested next move, provenance, and the actions.

### Conservative ICP scoring v1 (`trust-tai-icp-v1`)

Deterministic and explainable — no AI scoring. Each criterion is scored from
observed evidence only; unknown never counts as positive.

- Green: score ≥ 75 **and** at least 3 independent evidence points.
- Yellow: score 45–74, or a high score with thin evidence.
- Red: clear mismatch against the ICP.
- Neutral: not enough evidence to judge (all preview-demo candidates).

Fit is **never** stage. Colour reads ICP fit only; `discovered`, `qualified`,
`ready_for_comms`, `passed` are shown as neutral stage tags.

### Qualify and override

Qualify sets `status = qualified` and shows what happens next (decision maker,
handoff prep, Comms) — nothing is sent automatically. A member can override the
fit light manually; the override is stored in `metadata.scout_fit_override` and
the evaluator's original read is kept and displayed alongside it.

When a prospect was scored against an older ICP version, the drawer shows a
calm "Needs rescore" note rather than silently re-scoring.

## ICP evaluator v2 (`trust-tai-icp-v2`)

Scout's evaluator now reads the structured observations returned by
`scout-research` v3 with explicit, key-aware rules. v1/v2 rows without those
keys fall back to the original keyword rules unchanged.

| Criterion | v3 rule |
| --- | --- |
| Active and already serving people | `active_business_signals >= 3` met · 1–2 partial · 0/absent unknown. Revenue is never inferred. |
| Proven rather than idea-stage | `proof_signals >= 2` met · 1 partial. `testimonial_signals` / `case_study_signals` are supporting evidence. Absence is unknown. |
| Founder / owner reachable | `decision_maker_signals >= 1` is partial by default; met only when a `contact_routes` entry also exists. Reachability still requires human confirmation. |
| Clear offer | `clear_offer_signals = true` is met. `pricing_signal` supports, never replaces. |
| System / presentation gap | WordPress alone is never a gap. Requires real constraints: no lead capture, no booking despite services, no proof despite established activity, stale visible year, or a concrete `milestone_opportunities` entry. Two constraints met, one partial. |
| First milestone | Concrete `milestone_opportunities` only; the generic "deeper human review" fallback is ignored. Met when observed evidence backs the opportunity, otherwise partial. |
| Roadmap depth | Two or more concrete opportunities met, one partial. |
| Funding capacity | `pricing_signal = true` is weak/partial evidence only. Never inferred from schema markup, platform, or generic services. |

Thresholds are unchanged: green requires score >= 75 **and** at least three
clearly met ICP criteria. Evidence count counts met criteria, not raw
observations.

`pages_researched` is confidence context only. The drawer shows
`N public pages checked`, or `Research depth is thin` under three pages — fit is
never penalised for depth.

Existing rows keep their stored `metadata.scout_fit` until someone clicks
**Re-research website**, which rescores under v2 with `research_version: 3`
provenance. Qualify still sets `qualified` only; nothing becomes
`ready_for_comms` automatically.

## Relationship development doctrine (locked)

Scout finds, Comms develops, Roadmap builds. These laws govern the whole loop:

- **60% fit triggers research, not outreach.** Crossing the ICP line makes a
  company a candidate for deeper relationship-development research — nothing
  more. It never sends, never creates a Comms relationship, and never approves
  outreach.
- **The actionable Worth Knowing queue is people, not anonymous companies.**
  60%+ fit AND a traceable founder/decision maker is required. A strong-fit
  company with no person on record sits quietly as "Needs a person" — visible,
  never presented as ready.
- **The goal is to earn the next natural exchange, not a meeting.**
- **Text is a protected personal channel.** It is recommended only on explicit
  text-route evidence (a number they shared, a prior SMS conversation, an
  explicit text preference) — never from having met, an introduction, or a
  found phone number. Phone numbers are never inferred or scraped.
- **Deeper research is governed and bounded.** When eligibility is newly
  reached, Scout prepares a Relationship Development Brief (why now · what
  caught our attention · best way in · a useful bridge) from public
  professional evidence only. It re-runs only when eligibility is new,
  evidence moved, the brief is stale (30 days), or a person explicitly
  refreshes. Provenance (prepared at, evidence at, version) travels with the
  brief so the UI can say what was researched and when.
- **Roadmap is recognized from needs THEY revealed** — counterparty-authored
  words only, quoted history stripped. Our own copy can never manufacture a
  signal, and nothing is ever auto-created or pitched.

Implementation: `src/data/relationship-development.ts` (compute),
`src/data/supabase/scout-service.ts` (`prepareRelationshipDevelopment`),
`src/components/tt/scout/worth-knowing.tsx` (membership gate).

## One recommended next move (locked)

Scout behaves like a trusted advisor, not an analytics dashboard. The company
page has exactly one canonical decision surface: the **Recommended next move**
card at the top of the overview. One move, one clear reason, one primary
action. Everything else on the page is evidence for that card, never a
competing answer.

The move is computed by `buildRecommendedNextMove`
(`src/data/scout/recommended-move.ts`) from the eligibility read, the
governed brief, and the person's pacing decision. Six states:

| State | Headline posture | Primary action |
| --- | --- | --- |
| `in_comms` | Relationship developing in Comms | Open in Comms |
| `find_person` | Find the person first | Find the person |
| `research_first` | Understand them first | Prepare research |
| `no_urgency` | Worth knowing — no urgency | Prepare first message |
| `act_now` | Worth knowing now | Prepare first message |
| `not_ready` | Keep learning about this company | Research / none |

Laws:

- **No person, no first message.** Strong fit without a traceable
  founder/decision maker resolves to "Find the person first" — the drafting
  action is never offered.
- **The brief gates drafting.** A traceable person without a current governed
  brief resolves to "Understand them first." Drafting can never skip the
  governed research step.
- **Urgency is never manufactured.** A ready brief without a dated why-now is
  "Worth knowing — no urgency"; only real dated evidence produces "now".
- **Once in Comms, Scout stops behaving like outbound.** The move becomes
  "Open in Comms"; no first-message CTA remains in Scout.
- **Watch is a reversible pacing state, not a dead-end.** Watching companies
  keep their recommended move visible and can be resumed at any time.
- **"Prepare first message" is the explicit Scout → Comms transition.** It
  carries the governed brief and canonical prospect/person IDs across,
  confirms before handing over, and opens Comms where a person reviews the
  draft. Nothing is sent; sending is always Tai's click.

Duplicate decision surfaces were consolidated into this card: the overview no
longer carries a separate relationship-opportunity panel or a second
decision-state panel, and the right rail's "Potential next steps" list was
removed. The rail now holds quiet context only (At a glance, Top reasons,
Notes).
