# Pulse redesign — what deserves attention right now

Pulse becomes a scannable attention surface: four severity groups, compact signal rows, a restrained right rail, and a sidebar glance block. Pulse still owns visibility only — every row routes into the room that owns the change.

## What you'll see

**Top row** — `Pulse › What Tai is seeing`, quiet `Share pulse` / `More actions`, and `Last updated Xm ago`.

**Hero** — compact band: eyebrow `WHAT TAI IS SEEING`, serif statement "What the system noticed.", one supporting line, and a light radar/orbit mark on the right (SVG, no image asset).

**Summary + filters** — `HIGH-IMPACT SIGNALS`, then "N signals about the business are worth deciding." with filter pills: All / Act now / Evaluate / Watch closely / Good to know, each tinted to its severity, plus `Add filter` (source room, company).

**Four groups, never intermixed** — Act now (red), Evaluate (orange), Watch closely (amber), Good to know (blue). Each group shows a capped number of rows (3–5) with a `View all … signals` link that expands in place.

**Signal row** — one compact horizontal row, not a card:

```text
[icon]  Unblock the work that stopped moving          IMPACT  High     [ Review ]  ⋮
        1 project is blocked. Without access to GBP,  AGE     3 days
        work cannot continue and the date is at risk.
        PROJECT  Spartan Security › Houston Security Search Visibility
```

The `⋮` menu carries Accept / Not now / Not useful and "Why am I seeing this?" (reason, source room, evidence, confidence).

**Right rail** — Decisions at a glance (donut + four counts), one trend line (`↑ 2 vs last 7 days`, with the plain-language meaning), Top areas (Delivery / Decisions / Outreach / Opportunities), Recently updated (3 items + View all activity), and a small "What Pulse is" note.

**Sidebar** — under the suite nav, a Pulse-only block: the four counts, total, and a short "Your driver" note with a `How Pulse works` link. It appears only while you're in Pulse.

**Responsive** — rail drops below the main column at medium widths; rows stack title → summary → source → impact → action at small widths, keeping the severity colour visible.

## Where the signals come from

No new business state. The existing deterministic engine (`deriveSignals` over the suite snapshot) stays the source. A new presentation projection maps each `Signal` into a `PulseSignal` with severity, action label, entity lineage, impact and age — using explicit rules, not model judgment:

- **Act now** — blocked project, overdue reply, deadline at immediate risk, unanswered routed work past its threshold.
- **Evaluate** — open roadmap decision, qualified prospect with no owner, priority/sequencing choices.
- **Watch closely** — ageing conversation, waiting/stalled work, a signal approaching a threshold.
- **Good to know** — new strong-fit company, positive movement, informational discovery.

Action labels come from the owning room (Projects → Review / Resolve blocker; Comms → Reply; Roadmap → Decide / Clarify; Scout → Review company / Assign; Ops → Open issue), never a generic button.

Unanswered routed work keeps its current read and feeds Act now instead of sitting in its own section. The business read, learning trail and pending approvals stay on the page but move below the signal groups so the four groups lead.

## Feedback and learning

Accept / Not now / Not useful write a lightweight, org-scoped feedback row and an activity event; they never touch business truth. "Not now" suppresses prominence for 7 days; repeated "Not useful" on a signal rule lowers its default prominence only — it never removes a signal type and never expands authority. If the feedback table isn't applied yet, the actions degrade to session-only and the page still works.

## Technical notes

- New: `src/domain/pulse.ts` (PulseSignal, severity, feedback types), `src/data/pulse/projection.ts` (deterministic Signal → PulseSignal + grouping, counts, top areas, trend) with unit tests, `src/data/supabase/pulse-feedback.ts`.
- New components under `src/components/tt/pulse/`: `PulseHeader`, `PulseFilters`, `PulseSignalGroup`, `PulseSignalRow`, `PulseSeverityIcon`, `PulseImpact`, `PulseRightRail`, `PulseAtAGlance`, `PulseTopAreas`, `PulseRecentActivity`, `PulseDriver`.
- `src/routes/modules.pulse.tsx` becomes a thin composition route with the two-column layout.
- `src/components/tt/app-shell.tsx` gains an optional sidebar-context slot; no other room changes.
- Severity colours map to existing tokens (`destructive`, `warning`, `success`, `royal`) plus one new amber token in `src/styles.css` so watch-closely reads distinctly from evaluate. No hardcoded hex in components.
- New SQL doc `docs/pulse-feedback-schema.sql` (org-scoped RLS via `private.is_org_member`, grants) for you to apply — nothing else in the backend changes.
- Existing RLS, org isolation and permissions untouched; typecheck and the full test suite must pass.

## Assumptions

- Counts and examples in the mockup are illustrative; the page renders whatever the live snapshot yields, including a calm empty state.
- `Share pulse` copies a link to the current filtered view for v1 (no new sharing backend).
