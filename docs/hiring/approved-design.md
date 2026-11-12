# Approved CMD Hiring design

Source: approved overview.png, candidates.png and detail.png; baseline
5e1675c28373339bcdfe86572c13036f78ea2e23. Presentation only; unpublished.

## Reference intent and fidelity

Match the references' white object cards, pale ice canvas, compact metric rows,
horizontal navigation, semantic candidate table and wide/narrow detail columns.
The actual CMD shell, logo, Sora/Manrope/JetBrains Mono fonts and tokens win over
the references. Do not modify the shared sidebar. No sample people, photos,
growth percentages, fabricated activity or invented scheduling.

## Extracted design tokens

- Canvas: existing cloud oklch(0.974 0.012 250); cards: existing card/paper
  oklch(1 0 0); text: ink oklch(0.19 0.048 266).
- Actions: royal oklch(0.49 0.185 264), accent-foreground for action text.
  Identity: existing Alpine Cyan (--tt-app-scout); not a status color.
- Borders: cloud-line/rule oklch(0.906 0.016 250); secondary text:
  muted-foreground oklch(0.46 0.035 262). Existing royal-wash and cloud-strong
  provide quiet icon tiles and selected states. Chart colors derive from royal,
  cyan, plum, roadmap, projects, success and muted tokens; text labels carry meaning.
- Typography: Sora headings 36/28/20px, Manrope body 14px, metadata 12px;
  mono eyebrows 11px; normal letter spacing; semibold hierarchy, line height 1.5.
- Spacing: 4px base, 8/12/16/20/24/32px rhythm. Workspace 32px desktop,
  20px tablet, 16px mobile. Card padding 20px, gap 16px; table cells 12/16px.
- Geometry: workspace max 1400px, 8px object card radius, 1px borders,
  44px minimum controls, 4 KPI tracks / 5 candidate count tracks, 55:45 overview
  columns and 62:38 detail columns; 96px detail initials, 36px table initials.
- Effects: existing shadow-card only, 180ms color transition, visible royal
  focus ring, no decorative animation; reduced motion respected.

## Component map and states

HiringWorkspace (existing service/refresh/operation lock)
→ Hiring navigation: Overview / Candidates / Roles + Reload
→ HiringOverview: four MetricCards, OpenRoles, Pipeline, RecentActivity,
ApplicationsByRole (accessible donut with text legend)
→ CandidateList: filters, five MetricCards, sortable semantic table, pagination
→ Candidate (existing revision-keyed state and unchanged service calls)
→ identity header + Overview / Messages / Activity / Documents tabs
→ application answers and actual event feed / existing saved drafts
→ next-action summary, explicit editable details, private résumé card
→ existing JobEditor and Roles controls, no automatic role status changes
→ compact visible safety notice, cleanup reviewer Ayobami

Reuse Button and Lucide icons. Display-only selectors are confined to Hiring.
Loading/error/access failure do not fabricate zero counts. Missing selection is
explicitly unavailable. Empty snapshots have honest zero metrics. Revision-keyed
edit state, stale-save errors, draft preview and exact provider QA guards stay intact.

## Asset inventory

- All three uploaded images are references only; none are embedded.
- Actual CMD logo/sidebar/header remain owned by the existing shell.
- Applicant identity uses initials from actual names; no photograph fallback.
- Lucide outlined icons: people, briefcase, activity, check, mail, file,
  arrow, search, refresh. Donut is data-driven SVG, not decorative imagery.
- No missing media is needed; no new downloads or dependencies.

## Concise implementation plan

1. Add Hiring-only presentation selectors and overview/table components.
2. Compose reference layouts around existing candidate/job operations, preserving
   service inputs, revisions, notes, signed download and message receipt handling.
3. Apply scoped token-based styles and responsive table scrolling with visible
   controls; supporting detail moves below next-step on mobile.
4. Extend focused tests for counts, canonical stages, filters/sort/pagination,
   detail tabs, explicit save guards, private downloads and saved receipts.
5. Check 375/768/1440px using isolated synthetic test fixtures only, never seed
   runtime data. Run existing Hiring tests and available lint/typecheck checks.

## Fidelity adaptations and verification boundaries

Pipeline shows New/Reviewing/Interview/Offer/Hired/Declined/Withdrawn, all time
(no nonfunctional range menu). Metrics count applications, not deduplicated people;
active excludes Hired/Declined/Withdrawn. Hired applications are counted across
the available snapshot, not called hires this year because no hire-date field
exists. No growth claims.
Candidate toolbar filters search/role/stage/attention and applied-date range.
No bulk actions, manual creation, calendar integration, upload or fake attachments.
Messages use the existing draft/preview/test controls; no messages are sent in QA.
Private résumé link appears only after the existing authorized signing call.
Service snapshot is the entire available scope; the UI does not assert backend
coverage beyond that scope. Studio dependency errors must remain untouched.

## Verification

- Focused existing Hiring tests plus display/regression tests run with a temporary
  isolated Vitest configuration, no dependency or lock changes: 32 tests pass
  across 5 files, exit 0. Changed-file ESLint and whitespace check: exit 0.
  Command: `bunx vitest run --config /tmp/hiring-checks/vitest.config.ts`.
- Browser checks use a temporary intercepted localhost page importing the actual
  HiringWorkspace, existing global CSS and isolated synthetic service stubs.
  They do not use authenticated production data or embed fixtures in the app.
- Screenshots: `/tmp/browser/hiring-approved/{overview,candidates,detail,messages}-{375,768,1440}.png`.
  All sizes checked at normal zoom, no page overflow or runtime errors. Candidate
  table retains keyboard-focusable horizontal scrolling on compact screens.
  Pagination, search, all detail tabs, saved-draft preview, authorized private
  link and explicit revision-4 save checked; no sending invoked.
- Shared shell is deliberately not reconstructed in the visual harness; its
  existing header/logo/sidebar and access behavior are unchanged. Font families
  resolve through CMD's existing font loading, which the network-isolated harness
  does not download. No hosted/publication verification is claimed.
- Changed-file lint passes. Automatic full-project typecheck remains blocked by
  the eight pre-existing Studio coordinator SDK errors, with no Hiring errors.
  No dependency, Studio or automatic remediation is performed. Production build
  success is not claimed where the automatic checker supplies no successful build
  record; manual builds/typechecks are prohibited by this environment's workflow.
