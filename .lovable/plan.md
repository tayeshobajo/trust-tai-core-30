# Personal dashboard mockup match

## Reference intent
Rebuild the signed-in Home dashboard to closely match the supplied Trust Tai OS mockup: a compact weekly operating view with identity, goal progress, four metrics, task and activity columns, and a blockers strip visible within the first desktop viewport.

**Fidelity strategy:** Exact structural and visual match where the live product has corresponding data. Real workspace values, permissions, and empty states remain authoritative, so screenshot-only names, dates, counts, and activity are not fabricated.

## Reuse
- Keep Home at `/`, the logo destination at `/welcome`, and the existing workspace gate.
- Keep the current dashboard reader, weekly-goal confirmation, task completion, Undo behavior, and team privacy rules.
- Reuse the existing Trust Tai logo, icon set, semantic color tokens, fonts, button system, and shared bounded pagination logic.
- Keep all database, authentication, authorization, and external-action behavior unchanged.

## Create / modify
1. **Dashboard frame and density**
   - Tune the Home canvas and dashboard spacing to the reference proportions at 1440px desktop.
   - Keep the pale cloud canvas, opaque white cards, cool borders, restrained/no shadows, navy type, and royal-blue actions.
   - Preserve the responsive shell and collapse the layout deliberately for tablet and mobile.

2. **Identity header**
   - Match the compact three-zone header: identity at left, weekly operating statement centered, date/week block at right.
   - Use the real person name, role, initials/avatar state, current date, and computed week.

3. **Weekly goal panel**
   - Match the large progress ring, goal hierarchy, proposal badge, right-aligned confirmation action, progress explanation, and linked-task chips.
   - Keep confirmation human-controlled and derive every progress value from the existing goal and tasks.

4. **Metric cards**
   - Recompose the four cards as compact horizontal icon/value units with the level progress bar and navigation affordance styling shown in the reference.
   - Continue showing honest calculated values, including zero when no evidence exists.

5. **Tasks and activity**
   - Match the reference’s two-column proportions, section headers, grouped task bands, compact rows, statuses, metadata, Undo placement, and weekly activity summary.
   - Preserve title privacy on teammate views and all existing actions.

6. **Pagination**
   - Add independent, compact pagination to My tasks and AI teammate activity using the shared bounded pagination primitives.
   - Show 6 open tasks per page and 5 activities per page so each panel keeps the reference height and density.
   - Keep task grouping meaningful on every page, show accurate full-list ranges/totals, clamp pages after completion/Undo changes, and hide controls when one page is enough.
   - Use accessible Previous/Next and page-number controls with visible focus states; no page-size selector.

7. **Blockers strip**
   - Match the slim full-width final strip while retaining real blocker detection and the honest clear state.

8. **Regression coverage and visual verification**
   - Add tests for pagination boundaries, independent task/activity pages, grouping after slicing, page clamping after mutations, and unchanged action/privacy rules.
   - Compare the result at 375px, 768px, and 1440px. Verify no overflow, overlap, clipped controls, or fabricated values.
   - Run focused tests and use the preview build signal. Signed-in visual verification will be recorded as blocked if no authenticated session is available.

## Design tokens
- **Colors:** existing `background/cloud`, `card`, `foreground/ink`, `border/rule`, `royal`, `success`, `warning`, `destructive`, and their semantic washes only.
- **Typography:** Sora for display values/headings, Manrope for body and metadata, JetBrains Mono only for compact eyebrows; no font replacement.
- **Scale:** heading 18–24px, body 13–15px, metadata 10–12px; zero negative letter spacing in newly touched dashboard styling.
- **Spacing:** 12px dashboard rhythm; 16–24px card padding; compact 8–12px row gaps.
- **Geometry:** 12–16px card radii, 1px borders, stable circular icon wells and progress ring, fixed panel row heights where practical.
- **Effects:** minimal card shadow, short restrained transitions, reduced-motion support.

## Component map
```text
HomeRoute
└── AppShell
    └── PersonalDashboard
        └── PersonDashboard
            ├── DashboardHeader
            ├── GoalHeroBand
            │   ├── ProgressRing
            │   └── LinkedTaskChips
            ├── StatRow
            │   └── StatCard × 4
            ├── DashboardColumns
            │   ├── MyTasksPanel
            │   │   ├── TaskGroup
            │   │   ├── TaskRow
            │   │   └── DashboardPagination
            │   └── ActivityFeed
            │       ├── ActivityRow
            │       ├── WeeklySummary
            │       └── DashboardPagination
            └── BlockersStrip
```

## Asset inventory
- **Reference:** supplied screenshot, used only as the visual source of truth and not embedded.
- **Existing assets:** Trust Tai logo and Lucide icons.
- **New assets:** none required.
- **Missing assets:** none; identity avatar continues using the real profile image when available, otherwise initials.

## Do not touch
- No schema or migration work.
- No change to authentication, workspace membership, RLS, data calculations, source reads, confirmation authority, Undo semantics, sending, publishing, or external integrations.
- No mock data added to the signed-in product.

## Assumptions and known limits
- “Exactly like the mockup” means matching composition, density, hierarchy, and styling while preserving real data and accessibility.
- Pagination applies independently to the task and activity lists, the two potentially long dashboard regions.
- The current unauthenticated local preview only shows the fail-closed sign-in state; final signed-in screenshot comparison requires Tai or Codex if no session becomes available.
