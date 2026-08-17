# Scout Company Detail Redesign

Recompose `/modules/scout/prospects/$prospectId` around one question: **does this company deserve attention, and why?**

## What exists today (audited)

- Route `src/routes/modules.scout.prospects.$prospectId.tsx` loads the full candidate list, ICP profile, activity events and people, then renders `ProspectWorkspace` — a composed stack of ~15 equal-weight panels (`src/components/tt/prospect/*`). Flat by construction.
- Data is already rich enough for the redesign, no new schema needed:
  - `ProspectCandidate` (`src/domain/scout.ts`): prospect, `signals[]`, `fit`, `source`, `identity` (real logo URL + theme colour), `facts`, `profile` (industry/size/location), `history`, `intel`.
  - `ScoutFitEvaluation` (`src/domain/scout-fit.ts`): 0–100 score, light, `criteria[]` each with `state` (met/partial/missing/mismatch), `reason`, `sourceUrls` — exactly the ICP factor read model asked for, including "unknown ≠ not matched".
  - `ScoutIntel` (`src/domain/scout-intel.ts`): buying signals with type, statement, source URL, observed date; digital opportunities; people.
  - `scoutService.activity(orgId, prospectId)` already returns the company-scoped event ledger.
- **No notes table exists.** Notes will be recorded as note-type entries on the existing shared activity stream — no second ledger, no migration.
- No new migrations at all in this pass.

## Page composition

Weighted hierarchy, not uniform cards.

```text
breadcrumb  Scout > Companies > Name          Share  More  |  Prev  Next
+-------------------------------------------------------------+
| HERO  logo · name · status · ICP% · tags · one-line summary  |  visual
|  stat row: Score · ICP Match · Potential · Last seen · Added · Source
+-------------------------------------------------------------+
 tabs: Overview | Signals (n) | ICP Analysis | Notes | Activity
+---------------------------- 68% ------------+------ 32% -----+
| Scout summary (strongest card, ICP dial)    | At a glance    |
| Key signals (top 4, ranked)                 | Top reasons    |
| ICP factor alignment (8 of 10, 2-col)       | Next steps     |
| Recent Scout activity (compact timeline)    | Notes preview  |
| Similar companies (horizontal scroll)       |                |
+---------------------------------------------+----------------+
```

## Derived read models (new, deterministic, no duplicated truth)

- `src/data/scout/company-summary.ts` — `ScoutCompanySummary` (headline, paragraph, `topReasons[]`, icpMatch, score, potential, confidence, computedAt) derived from evaluation + intel.
- `src/data/scout/top-signals.ts` — ranks signals by strength, recency, confidence and **type diversity**; returns a bounded 4 for Overview.
- `src/data/scout/icp-factors.ts` — normalizes `FitCriterion` → `ICPFactorResult` (matched / partial / not_matched / unknown, value, contribution, confidence, reason, evidence[]).
- `src/data/scout/next-steps.ts` — bounded actions gated by real capabilities: research leadership (people providers available), track for signals, prepare Comms handoff (existing `routeToComms`), add note. Unsupported actions are omitted, never faked as outreach.
- `src/data/scout/similar-companies.ts` — deterministic scoring over the already-loaded board list (industry, size band, location, fit light proximity); top 6, read-only.

Each gets targeted unit tests alongside the existing `src/data/scout-*.test.ts` files.

## Components

New `src/components/tt/scout/detail/`: `company-hero.tsx`, `detail-tabs.tsx`, `scout-summary.tsx`, `key-signals.tsx`, `icp-alignment.tsx`, `activity-timeline.tsx`, `similar-companies.tsx`, `detail-rail.tsx`, `notes-tab.tsx`, `signals-tab.tsx`, `icp-analysis-tab.tsx`.

Existing prospect panels stay in the repo and are reused where they fit (people panel under a rail action, handoff panel behind the Comms next step). `ProspectWorkspace` is no longer the page root.

Logo: `companyIconSources()` from `src/lib/company-identity.ts` with an initial-mark fallback; broken images never render. Hero right side uses the recorded theme colour as an Ambient Identity Wash when no real image exists — no fabricated photography.

## Tabs

- **Signals** — full list with type, explanation, source, strength, confidence, observed date, provenance; filters for type / strength / recency / source.
- **ICP Analysis** — per-factor status, score contribution, evidence links, confidence, and the plain reason it matched or failed.
- **Notes** — add note + list (author, timestamp) via the activity stream.
- **Activity** — the existing company-scoped event ledger.

Tab content beyond Overview is lazy-mounted.

## Navigation, state, responsiveness

- Prev/Next walk the current filtered board order (existing `section` / `fit` search params, extended with the list index context); filters and pagination survive the round trip.
- Below `lg`, the right rail drops beneath the main column; hero stacks; similar companies stay horizontally scrollable; no horizontal overflow at 375px.
- Accessibility pass: tab roles, focus states, 44px targets, status never conveyed by colour alone.

## Verification

Empty state for every section, typecheck, full test suite, and a signed-in Playwright pass at 375 / 768 / 1440.
