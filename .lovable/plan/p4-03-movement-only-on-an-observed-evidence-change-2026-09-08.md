# P4-03 — Movement only on an observed evidence change

Inspection + acceptance definition + mockup spec. No implementation in this turn.
P4-01 and P4-02 stay open. No percentages change. Required level: Code/Test Verified.

## 1. What exists today

- UI: `src/components/tt/scout/movement.tsx` — the Movement view, one row per company, links to the prospect page.
- Logic: `computePulse()` in `src/data/prospect-modules.ts`, type `SignalPulse` in `src/domain/prospect-modules.ts`. Also reused by `src/components/tt/prospect/signal-pulse.tsx`.
- History it reads: `prospects.metadata.research_history` — an append-only log of *scored runs* (`at`, `score`, `light`, `pages`, `evidenceCount`, `metKeys`).
- Real observed evidence lives in `prospects.observed` (array of signals: statement, source url, provenance/observed-at) and is merged by `mergeObservedRows()` in `src/data/scout/research-run.ts`.
- Write paths that touch observed evidence: `writeObservation()` in `src/lib/scout-sweep.server.ts` (scheduled sweep) and the research save path in `src/data/supabase/scout-service.ts`.

Canonical source P4-03 should read: **the observed evidence itself**, not the scoring log.

## 2. Does today's Movement satisfy the gate? No.

`computePulse()` derives movement from the fit score delta and from which ICP criteria were "met". Its headline sentence is "Fit rose N points". That is an evaluator/inference read, and it changes whenever the ICP definition, the evaluator, or the page count changes — with no new fact observed. It reports "Fit held steady" as a pulse, so companies can surface with nothing observed changing. This violates: observed-only, no false positives, no ranking/score framing, quiet stays quiet.

Verdict: Movement must stop reading `research_history` and read an observed-evidence delta. `computePulse` stays where it is used as a fit-history read on the company page (clearly labelled as fit), but it no longer feeds the Movement view.

## 3. Smallest canonical record

No new table, no new status, no duplicate store. One bounded, append-only marker inside the existing `prospects.metadata` JSON:

`metadata.observation_log` — at most the last 10 entries:

```text
{ at, added: [{key, statement, sourceUrl}], removed: [...], changed: [{key, from, to, sourceUrl}], readKeys: [...] }
```

Why stored and not purely derived: only the *current* merged `observed` array is persisted today; the prior state is discarded at merge time, so a delta cannot be recovered after the fact. The entry is written at the moment of merge, by the code that already computes `added` / `replaced` / `kept`, using only observed rows. Nothing inferred or suggested is ever written into it.

Boundary preserved: the sweep records what it observed (evidence). P4-03 is a pure reader — `src/data/scout/movement.ts` — that turns the log into a Movement projection. No schema change, no migration.

## 4. What counts as an observed evidence change

Deterministic, per observed row, keyed by the existing observation `key`:

- **Added** — a key present now, absent in the previous observed set.
- **Removed** — a key present before, and the pass actually re-read that area and did not find it. A key untouched because the pass never covered that area is *kept*, never removed.
- **Changed** — same key, materially different statement text after normalising whitespace and case.
- **Source moved** — same key, same statement, different source URL. Recorded, shown quietly, and it alone does not put a company in Movement.

Every entry carries the observed timestamp of the pass that produced it.

## 5. What does NOT count

Fit score movement; criteria met/unmet; ICP version change; evaluator or research version change; page count change; freshness/last-checked timestamp; a re-read that returned identical evidence; an unreadable or skipped company; anything from `inferred` or `suggested`; watchlist add/remove; a human note; source-URL-only change on its own; the first pass ever (nothing to compare against, so a first read is coverage, not movement).

Unknown and unreadable stay unknown and unreadable, never negative movement.

## 6. UI treatment

Same Movement view, same Scout surface, same list style. No dashboard, no badge, no notification, no reorder of any other view.

```text
Movement                          Changes observed since the previous read

[logo] Northwind Studios                                    12 Sep, 09:14
       Now says it works with clinics (Services page)
       Pricing page no longer states a starting price
       2 changes observed  ·  View sources

[logo] Harbor & Co                                          11 Sep, 07:02
       Contact page now lists a named founder
       1 change observed  ·  View source
```

- Sorted newest observed first. Timestamp is the observed time, shown as an absolute date and time, not "2 days ago".
- Each line is one observed change in plain words; the source page is a link when a real URL exists, otherwise "no page recorded".
- Colour: Trust Tai blue only. No green/red on gain/loss — a change is not good or bad. Amber only for "source page moved".
- Empty state (unchanged in tone): "No change since the last look" plus the existing honesty note.
- No "act on this", no urgency wording, no score anywhere in this view.

## 7. Grouping

One row per company, never one row per change. Within a company: at most three change lines, newest first, then "and N more" linking to the company page. Multiple passes on the same day collapse into the company's latest entry; the row shows the newest observed time. A company whose only entries are source-moved shows those lines but is placed after companies with substantive changes, without any score.

## 8. Tests (pure, no network)

New `src/data/scout/movement.test.ts` plus additions to the existing sweep/merge tests:

1. Identical re-read produces no movement entry at all.
2. Fit score change with identical observed evidence produces no movement.
3. ICP version change alone produces no movement.
4. An added observation produces exactly one entry with the correct statement, key and observed time.
5. A statement edit produces "changed", carrying both old and new text.
6. An area not covered by the pass is never reported as removed.
7. Inferred/suggested changes never appear.
8. Unreadable/failed pass writes no movement entry and does not clear prior evidence.
9. First-ever pass produces no movement.
10. Replaying the same pass twice is idempotent — no duplicate entry.
11. Wording snapshot for each change kind, so copy stays plain and non-urgent.
12. Empty projection yields the quiet state.
13. `research_history` is not read by the movement module (import-level assertion).

Plus typecheck, changed-file lint, full suite, build.

## 9. Runtime QA (beyond the formal gate)

The gate is Code/Test Verified, so no production sign-off is required. One optional confirmation after tonight's scheduled run: check that a company whose public page genuinely changed shows a movement line with the right wording and observed time, and that untouched companies stay absent from Movement.

## Technical summary

- New: `src/data/scout/movement.ts` (pure projection + wording), `src/data/scout/movement.test.ts`.
- Edited: `src/components/tt/scout/movement.tsx` (reads the new projection), `src/lib/scout-sweep.server.ts` and the research save path in `src/data/supabase/scout-service.ts` (append the bounded observation log at merge time, observed rows only).
- Unchanged: `computePulse` and the company-page fit history, all other Scout views, statuses, scores, navigation, storage, schema.
