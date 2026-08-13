# Scout Prospect Workspace — next evolution

The prospect page today is one static column stack: header, fit criteria, opportunity, decision-maker, signals, disclosures (`src/components/tt/prospect-workspace.tsx`, 520 lines, all sections always rendered). Everything about a company is already stored in `prospects.observed / inferred / suggested / provenance / metadata`, and `activities` already records `prospect.researched` and status changes — but the page reads almost none of that as *change over time*, and there is no people layer at all.

This plan turns the page into an adaptive company workspace: same calm shell, but the surfaces present themselves according to the evidence actually held, and a People + Contact Intelligence layer is introduced.

---

## 1. Information architecture

Three vertical zones, one dominant idea each. No dashboard grid, no equal cards.

```text
IDENTITY BAND     company mark, name, domain, fit light, stage, next move
  (brand accent rule + faint wash — already built, given more room)

DECISION COLUMN (2/3)              CONTEXT RAIL (1/3)
  Next move                          Research coverage
  Why this fits / does not           Signal pulse (what changed)
  Opportunity map                    Provenance & freshness
  People & contact intelligence      Activity timeline
  Handoff readiness
```

Rules that keep it Trust Tai rather than a dashboard:
- Exactly one primary action visible at a time, chosen by stage (Qualify → Find decision-maker → Verify email → Hand to Comms).
- A surface with nothing honest to say is **not** rendered as an empty card; it collapses to one line in a single "Not yet known" strip with the action that would fill it.
- Anything inferred is labelled; anything a human decided is labelled; the two never share a visual treatment.

## 2. Adaptive modules

Each module declares: `id`, `requires` (evidence predicate), `weight`, `stage relevance`, `render`. The page composes visible modules from stored evidence — this is the generative layer, deterministic in v1.

| Module | Appears when | Says |
| --- | --- | --- |
| Company identity band | always | who this is, brand accent, fit, stage |
| Next move | always | the single decision now, with owner |
| ICP fit read | `evaluation.scoreable` | met / partial / unknown criteria (existing, condensed to a scannable strip + detail) |
| Opportunity map | opportunity criteria present | limiting system → first milestone → roadmap depth as a Point A → B → C spine |
| Signal pulse | ≥2 research runs stored | what changed between runs: score delta, new/lost evidence |
| Research coverage | live research row | pages checked, which page types (`offer/proof/team/contact_page_checked`), what is unread |
| People graph | ≥1 contact | decision-makers with role, confidence, source |
| Decision-maker confidence | people present | one line: can we reach the person who decides? |
| Activity timeline | ≥1 activity | research, status, override, people events from `activities` |
| Handoff readiness | status ≥ qualified | checklist gating Comms: fit, decision-maker, verified email, next move |

New/changed files: split `prospect-workspace.tsx` into `src/components/tt/prospect/` (`identity-band.tsx`, `next-move.tsx`, `fit-read.tsx`, `opportunity-map.tsx`, `signal-pulse.tsx`, `coverage.tsx`, `people-panel.tsx`, `timeline.tsx`, `handoff.tsx`) plus `src/domain/prospect-modules.ts` (module registry + predicates) and `src/data/prospect-modules.ts` (selection from a candidate).

## 3. Analytics worth having

Derived from evidence already stored — no new telemetry, no charts for their own sake.

- **Fit trajectory** — score per research run from `provenance.research_version` + stored history; renders as a 3-dot sparkline, not a chart.
- **Evidence delta** — criteria that moved met/unknown/mismatch between runs.
- **Research coverage %** — checked page types over expected page types; drives "what is unread".
- **Staleness** — days since `lastCheckedAt`, and ICP-version drift (already computed, promoted into the pulse).
- **Reachability** — do we have a named decision-maker + a verified email; the single strongest predictor of Comms success.
- **Board-level (Scout index)** — counts by fit light and stage, and "N prospects need rescore". Nothing else.

## 4. People + Contact Intelligence

Data model (new `contacts` usage — `contacts` already exists as a core shared table; extend rather than invent):

```text
contact: id, organization_id, prospect_id | client_id, full_name, role_title,
         seniority (founder|owner|exec|marketing|operations|other),
         linkedin_url, email, email_status, confidence,
         source (manual|provider:<name>|website), provenance jsonb, metadata jsonb
```

- `email_status`: `unknown | found | verified | risky | invalid | bounced`. Never show an unverified email as if verified.
- `confidence`: `observed | inferred | asserted_by_provider | human_confirmed`. A human confirmation always outranks a provider.
- **Provider abstraction**: `src/domain/people.ts` (contracts) + `src/data/people/provider.ts` with a `PeopleProvider { discover(company), findEmail(person), verifyEmail(email) }` interface. v1 ships a `website-people` provider (team/contact pages already read by `scout-research`) and a stub compliant-enrichment provider behind an Edge Function, so no key ever reaches the browser.
- **No LinkedIn scraping.** LinkedIn URLs are stored only when a provider returns them or a human pastes one; they are links, never a crawl target. Documented in `docs/scout-people-v1.md`.
- **Manual override** always available: add a person, correct a role, mark an email confirmed. Human edits are provenance-stamped and never overwritten by a later provider run.
- **Handoff to Comms**: a contact is "Comms-ready" only when name + role + `email_status ∈ {verified}` + a next move exist. Handoff writes `prospect.status = ready_for_comms` and an activity, matching the existing lifecycle.

## 5. Generative / adaptive architecture

Three strictly separated tiers, visually distinct:

1. **Deterministic facts** — what a public page said, what a provider asserted, what the evaluator computed. Stored, replayable, sourced.
2. **Model inference** — "why this fits", suggested next move, role guessing. Always labelled, never auto-actioned, never written into fact fields.
3. **Human decision** — qualify, pass, override, confirm contact. Immutable to automation.

Triggers (deterministic rules, evaluated on load, no background jobs in v1):
- ICP version changed → mark "needs rescore", offer one-click re-research.
- Last research older than 30 days → stale badge.
- Coverage below threshold or key page unchecked → "research is thin" with the re-research action.
- Status moved to qualified with no decision-maker → People module becomes the page's next move.

Layout adaptation is a pure function: `selectModules(candidate, contacts, activities, icp) → ordered module list + one next move`. Testable without rendering.

## 6. Supabase changes

Minimal v1 — no new columns on `prospects`.

- Use the existing `contacts` table for people; add only what is missing, guarded by grants + RLS mirroring `prospects` (org-scoped, `authenticated` grants, `service_role` all).
- Store research history inside `prospects.metadata.research_history` (append-only array of `{ version, score, light, pages, at }`) so fit trajectory works with zero schema change.
- People discovery/verification run in Edge Functions (`people-discovery`, `email-verify`) so provider keys stay server-side; the client only ever calls them authenticated.
- Future path: promote `research_history` to a `prospect_research_runs` table and contact enrichment to `contact_enrichments` once volume justifies it. The client reads through `src/data/supabase/*` repositories, so the swap is contained.

## 7. Build order

1. **Modularise the workspace** — extract `src/components/tt/prospect/*`, add `selectModules`, keep behaviour identical. Ship the identity band + next move + condensed fit read.
2. **Coverage + signal pulse + timeline** — append `research_history` on each research save, read `activities` for the timeline. Highest value per effort, zero new backend.
3. **People v1, manual first** — contacts model, People panel, add/edit person by hand, decision-maker confidence, handoff readiness gate.
4. **People discovery from already-read website pages** — reuse `scout-research` output; no new provider.
5. **Compliant enrichment + email verification** behind Edge Functions, provider-agnostic.
6. **Adaptive polish** — stage-driven ordering, "not yet known" strip, empty-state copy pass.

## 8. Risks to avoid

- Turning the rail into a widget wall. If a surface cannot state a decision or a fact, it does not exist.
- Charts. Sparklines and deltas only; Scout is an editorial brief, not analytics.
- Brand colour creep — company accent stays on the rule, dot, and faint wash. Fit lights, stage pills, buttons, and shell remain Trust Tai.
- Presenting provider guesses as facts, or an unverified email as reachable.
- Any LinkedIn crawl or protection bypass. Links only.
- Over-modelling ahead of use: no new tables until `metadata` genuinely strains.
- Losing fail-closed behaviour: every new read stays inside `WorkspaceGate` and org-scoped RLS.

---

### Technical notes

Likely touched: `src/components/tt/prospect-workspace.tsx` (split), `src/routes/modules.scout.prospects.$prospectId.tsx`, `src/data/supabase/scout-service.ts`, `src/data/supabase/prospects.ts` (history append via existing `mergeProspectMetadata`), `src/data/supabase/activities.ts` (subject-scoped read), `src/domain/scout.ts`.
New: `src/domain/people.ts`, `src/domain/prospect-modules.ts`, `src/data/people/*`, `src/data/supabase/contacts.ts`, `src/components/tt/prospect/*`, `docs/scout-people-v1.md`.
