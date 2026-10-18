# Steward suite sidebar restoration

## Compact token/component/asset plan (before implementation)
- Reuse `AppShell` and its permission-filtered `NavList`, shared account controls, existing `BrandLogo` and registry icons. Keep the normal suite rail at desktop and a named app-navigation Sheet at compact widths.
- Add an opt-in workroom canvas to `AppShell`: no page gutters or reading-width cap. Other rooms retain their existing layout.
- Embed the real Steward workroom beneath the single suite header; retain its room title/More menu, meetings, all-outstanding link, selected-task source/history and existing data wiring. Hide only its duplicate brand/account header controls in embedded mode.
- Size meeting/task/detail columns against the available canvas using container breakpoints; compact drawers use that same available-width decision.
- Reuse `background`, `card`, `sidebar`, `cloud`, `secondary`, `border`, `royal` and existing status tokens, Sora/Manrope typography, 1px dividers and existing Lucide icons. No assets, fonts, palettes or routing changes.
- Keep the standalone/mockup presentation unchanged. Atomic completion stays blocked; no database work.

## Verification
Pending focused tests, changed-file lint, automatic preview build and fictional desktop/tablet/mobile browser checks. Authenticated preview is unavailable (`no_supabase`); no authenticated real-data claims will be made.