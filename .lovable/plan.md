# P4-04, coverage reported as counts only

Required level: Runtime Verified. This document is the acceptance definition and the
mockup spec. No implementation in this pass.

## 1. Where Scout reports coverage, confidence, fit, counts or completeness today

| Surface | File | What it says |
| --- | --- | --- |
| Research coverage card (company page rail) | `src/components/tt/prospect/coverage.tsx` | "4 of 6 page kinds read · 11 pages read", per-kind read/unread chips, absence note. Already counts-only. |
| Coverage computation | `src/data/prospect-modules.ts` `computeCoverage()` | Produces `pages`, `checked[]`, **`percent`**, `note`, **`thin`** (a derived completeness label). |
| Decision metrics | `src/data/scout-intel.ts:272-296` | Feeds `coverage.percent` into a weighted metric `research_coverage` with a 0-100 value. |
| Scout at a glance (right rail) | `src/components/tt/scout/support-rail.tsx:14` | Board counts, each annotated "N% of total". |
| Left rail glance | `src/components/tt/scout/sidebar.tsx` | Counts only. Clean. |
| Sweep strip | `src/components/tt/scout/sweep-strip.tsx` | Counts only, explicitly no percentage. Clean, and the model to follow. |
| Fit pills | `worth-knowing.tsx`, `identity-band.tsx`, `signal-pulse.tsx` | `NN% fit`. Fit score, not coverage. |
| Inbound stated confidence | `src/components/tt/scout/inbound.tsx:57` | Confidence as a percentage on stated founder answers. |

## 2. Facts vs theater

Actual coverage facts (observed, countable, sourced):

- number of public pages read (`evaluation.pagesResearched`)
- which page kinds were reached, from the boolean `facts[kind]` flags
- number of distinct observed evidence rows held (`prospects.observed`)
- when the last read happened (`lastCheckedAt`)
- how many watched companies have never been read (from the P4-02 sweep plan)

Not coverage, and must not be dressed as coverage:

- `coverage.percent` - a ratio over a fixed six-kind list, so a company that
  legitimately has no careers page can never reach 100. Presentation theater.
- `coverage.thin` - a completeness/health label derived from that percentage.
- `research_coverage` metric value in `scout-intel.ts` - a composite score.
- "N% of total" in the support rail - a share, not a coverage fact.
- fit score percentages - fit, allowed, out of P4-04 scope, and stays supporting
  evidence only.

## 3. The smallest canonical coverage contract

Change `ResearchCoverage` to carry counts and honest absence only:

```ts
export interface ResearchCoverage {
  pages: number;                 // public pages read
  facts: number;                 // distinct observed evidence rows held
  checked: { key: string; label: string; reached: boolean }[];
  reached: number;               // checked.filter(reached).length
  lastReadAt: string | null;     // null means never read
  state: "never_read" | "unreadable" | "read";
  note: string;                  // plain absence language, no judgement
}
```

Removed: `percent`, `thin`. Everywhere `thin` gated confidence or emphasis, the
replacement test is an explicit count law stated in code, e.g. `pages < 3` or
`reached === 0`, named `sparse` and never rendered as a label to the user.
`scout-intel.ts` keeps a `research_coverage` entry only as an unweighted context
line, or its value becomes `null` (unknown) rather than a synthesised score;
recommendation is to keep the metric list intact but set the coverage metric's
value to `null` with a counts sentence in `because`, since `null` already sorts
as unknown rather than zero.

No schema change. No new store. All counts derive from data already held.

## 4. Where the counts appear

Two existing surfaces, no new ones:

1. **Company page rail, Research coverage card** - already the home of per-company
   coverage. Keep the card, drop nothing visually except the internal percentage
   dependency, add the facts count and the last-read line.
2. **Watchlist sweep strip** - already counts-only. Add one line of board-level
   coverage: "N watched · N read · N never read". This is the "at a glance"
   coverage answer and reuses the P4-02 summary that already computes it.

The right-rail "N% of total" annotation is removed. No chart, no dashboard, no
progress bar, no new tab.

## 5. Empty, unknown, unreadable

| State | Condition | Copy |
| --- | --- | --- |
| Never read | no research pass on record | "Not researched yet." No counts shown, not "0 pages read". |
| Unreadable | a read was attempted and the site could not be read | "The website could not be read on the last attempt." Prior counts, if any, stay visible with their own date. |
| Preview record | `source.kind !== "live_website"` | "Preview records are not researched, so there is nothing to report." |
| Read, kinds unknown | pass predates page-kind flags | "N pages read. Page kinds were not recorded on this pass." |
| Read, some kinds unreached | normal | "N of M page kinds read · N pages read · N facts held", plus "Careers and team pages were not reached. Absence there is not treated as a gap." |

Unknown is never rendered as `0` and never as a dash inside a numeric slot: it is
a sentence. Zero is only printed when a real read genuinely returned nothing.

## 6. Consistency with the rest of P4

- **P4-01 Watchlist** - board-level coverage counts are computed over the watched
  set only, the same curated list, no new membership concept.
- **P4-02 sweep** - the sweep summary is the single source of "read / never read /
  skipped" counts. P4-04 renders them, it does not recount them independently.
- **P4-03 Movement** - coverage answers how much was read, Movement answers what
  changed. A page read with no change contributes to coverage and stays silent in
  Movement. Coverage never causes a Movement row, and a Movement row never
  implies coverage improved.
- **Readiness gate** - coverage is never part of readiness. Readiness stays person
  plus governed brief. High coverage must not promote a company, and thin
  coverage must not demote one below unknown.

## 7. Mockup spec

Company page, Research coverage card (existing card, same border, same rail
position, Trust Tai blue only, no traffic lights):

```text
RESEARCH COVERAGE
4 of 6 page kinds read · 11 pages read · 23 facts held
[home read] [about read] [services read] [contact read]
[team unread] [careers unread]
Team and careers pages were not reached. Absence there is not
treated as a gap.
Last read 6 September 2026.
```

Never-read variant:

```text
RESEARCH COVERAGE
Not researched yet.
Nothing has been read from this website, so there is nothing to report.
```

Watchlist, inside the existing sweep strip, one line under the last-run line:

```text
12 watched · 9 read · 3 never read · 1 could not be read
```

Chips keep their current styling: solid border for read, dashed border and muted
text for unread. No colour encodes coverage.

## 8. Tests and runtime QA

Unit tests (`src/data/prospect-modules.test.ts`, plus a coverage-copy test):

1. `computeCoverage` returns no `percent` field and no health label.
2. Never-read record returns `state: "never_read"` and copy that does not contain
   `0 pages`.
3. Unreadable record keeps prior counts and dates them, never reports a loss.
4. Preview record reports nothing to report.
5. Kinds-unknown pass reports pages only, no fabricated kinds.
6. Full coverage reports "6 of 6" and never "100%".
7. Facts count equals distinct observed rows held, not evidence used for fit.
8. A repository-wide assertion that no Scout coverage component renders `%`
   (fit pills excluded by explicit allowlist).
9. `scout-intel` coverage metric value is `null`, not `0`, when never read.
10. Board line counts match the P4-02 sweep summary for the same watched set.
11. Coverage changes do not add, remove or reorder Movement rows.
12. Coverage never affects the readiness queue membership.

Runtime QA for Tai (needed to reach Runtime Verified):

- Open a researched company in Scout and confirm the coverage card shows counts
  and a last-read date, with no percentage and no health word anywhere.
- Open a watched company that has never been researched and confirm it reads
  "Not researched yet", not "0 pages read".
- Open Watchlist and confirm the one-line board coverage matches the number of
  watched companies actually researched.
- Confirm Movement is unchanged by any of the above.
- Confirm no readiness or ordering changed as a result.

## Out of scope

Fit percentages, inbound stated confidence percentages, any new store, status,
chart, room or notification.
