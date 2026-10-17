# Approved Steward preview — October 17, 2026

## Build plan

**Reference intent:** Implement the approved `approved-steward.png` as a compact meeting homework workspace, only at `/mockups/steward-next`.
**Fidelity strategy:** Close desktop match; retain existing CMD fonts and semantic colors, with accessible mobile adaptation.
**Reuse:** BrandLogo, TTButton, TTInput, Sheet/Dialog, Lucide icons, fictional fixtures and append-only preview helpers.
**Create / modify:** Route-local composition, searchable meeting rail, explicit task columns, persistent selected-task panel, responsive drawers, focused tests.
**Do not touch:** Production shell/styles, canonical task data, session import, authentication, permissions, integrations, schema or publishing.

## Extracted design token block

- Color roles sampled visually: navy ink approximately #01051b → existing foreground; white → card; pale blue approximately #f5f9ff → cloud; blue-gray rules approximately #dadee5 → border; selected blue approximately #e8f2ff → secondary; royal action → royal; amber score → warning; green verified → success. These existing OKLCH semantic values take precedence over approximate bitmap samples. Avatar roles use existing plum, warning, success and muted tokens.
- Typography: existing Sora headings / Manrope UI, zero letter spacing; title 24px/32px 600; panel title 18px/26px 600; task 14px/20px 400; labels and metadata 12px/18px; score 24px/30px 600. No tiny task text or zoom/scaling.
- Spacing: 4px base; 8–12px control gaps; 16px meeting rail inset; 24px main and detail inset; 20–24px detail section rhythm.
- Geometry: header 56px; desktop 18% / 56% / 26%; 1px borders; 6–8px radius; task rows 44px minimum; icon controls 44px targets; ring 44px with 6px stroke; progress bar 8px. Central grid uses flexible Task, Owner 116px, Due 104px, Status 92px. Below 1200px details become a drawer; below 640px meeting rail becomes a drawer and task metadata stacks.
- Effects: no decorative shadow; existing 180ms transition; reduced motion respected; a short explicitly sample-only preparation loading state.

## Component map and states

StewardPreview → PreviewHeader + MeetingNavigation + MeetingWorkspace (Score, ProposalCallout, Search/Owner/Status filters, WorkRow × 12, RemainingWork) + TaskDetails.
TaskDetails → NextMove + AIHelp + EvidenceControl + MeetingSource + ReceiptHistory.
Desktop TaskDetails is persistent; smaller screens reuse it in a modal Sheet with focus management and close control. Meeting navigation is similarly available in a mobile Sheet. Selection, filters, source/history expansion, prepare/loading/ready, empty search, evidence-disabled, blocked dependency, proposal-owner-required, complete/reopen and partial-coverage states are explicit.

## Asset inventory

- Reference: uploaded screenshot, inspection only; never embedded in the app.
- Logo: existing `BrandLogo` and its bundled Trust Tai assets, unmodified.
- Icons: existing Lucide family (calendar, search, circle/check, flag, lock, sparkles, link, history, chevron, close).
- New imagery: none. Meeting sources are invented text, not private transcripts or live external links.

## Rules and tradeoffs

Initial fixtures are exactly 12 tasks: 11 agreed, 3 verified, 1 proposal. Score and counts derive from data; use rounded percentages, but reserve 100 for fully verified complete coverage. Unknown and spoken dates stay distinct. Preserve cross-meeting outstanding navigation even though it is absent from the image. No real loading/network behavior is implied: only static illustrative AI preparation has a timed sample loading state. All state resets on reload.

## Verification plan

Run focused domain and component tests plus changed-file lint; inspect harness build/typecheck signals (do not manually build). Drive desktop 1440×900, tablet 768 and mobile 375×812, compare screenshots to the approved image, check geometry and overflow, and exercise meeting/task search, filters, selection/close, source/history, AI preparation, completion/reopen, proposal/dependency gates and reload reset. Hosted availability is verified separately and never inferred from localhost.