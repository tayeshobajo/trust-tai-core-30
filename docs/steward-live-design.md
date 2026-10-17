# Steward live workspace — precision artifacts

Approved reference: `approved-steward-current.png` (1586×992). Fidelity strategy: brand-consistent interpretation on real data — same hierarchy, proportions and density; no fictional fixtures in the live bundle.

## Design token block

- Colors: existing semantic tokens only — `card` (white panels), `secondary` (cloud rail), `border` (1px light blue-gray dividers), `primary` (royal blue actions/selected row tint), `success` (verified rows/counts), `warning` (amber score when partial), `destructive` (overdue), `muted-foreground` (metadata).
- Typography: existing brand fonts (Manrope/Sora via `font-display`). Meeting title 24–28px `font-display`; task titles 14px; metadata 12px; column headers 11px uppercase tracking.
- Spacing: 16–24px panel padding; 44px task rows; 8–12px gaps.
- Geometry: radii 8–12px (`rounded-lg`); 1px dividers; no large card shadows. Proportions at 1440: rail ~18%, main ~56%, detail ~26%.
- Effects: selected row `bg-primary/5` + left accent; verified row `bg-success/10`; score ring via simple SVG arc, amber until 100, green at 100.

## Component map

- `StewardWorkroom` (route `/modules/steward`, in `src/components/tt/steward/workroom.tsx`)
  - `MeetingRail` — search + meeting list, each with date, verified/agreed, coverage pill
  - `MeetingPanel` — title/date/participants/View meeting link, score card, proposal callout, filters (All/Open/Completed + search + owner), task table, bottom 100/100 remark
  - `TaskDetail` — right panel (desktop) / Sheet drawer (mobile): owner, due certainty, source evidence quotes, meeting source link, links to the existing review page for confirm/complete and meaning-reading
- `StewardTabs` — compact: Meetings (workspace), Team, More (Tasks, Agents, Scouts, Trust Tai AI, Timeline, Memory)

## Asset inventory

- No new imagery. BrandLogo via existing AppShell; lucide icons only.

## Data rules (real data only)

- Verified = commitment `status === "kept"` AND a current completion receipt (`steward_task_state` row for `commitment:<id>` with `completed_at`). Kept-without-receipt shows "Needs verification", never green.
- Released commitments leave the denominator; unconfirmed proposals are never in it.
- Score only when transcript coverage is complete (recording length known); otherwise counts without a score. Last-timestamp-within-120s is never treated as proof of completeness.
- Auto-pull: while an authenticated Steward page is open (mount + window focus + 5 min interval, concurrent runs deduped), recent Fathom calls are read through the existing member-authorized endpoints and upserted through the existing `saveConversation` pipeline (dedupe on org/provider/external id and source URL). Zero-transcript reads are never stored over a full transcript. Closed browser = no sync; said plainly in the UI.

## Responsive plan

- 1440: three columns, 10–15 rows visible. 768: rail + main, detail in drawer. 375: rail collapses into a selector, first actionable task in the first viewport, detail in a Sheet.
