# Roadmap

## Steward read-only task history (2026-10-18)
- [ ] Query selected commitment history through existing member RLS; show recorded events and explicit loading/error/limited coverage, distinct from receipts.
- [ ] Correct completion-route and sync-caution copy; verify focused tests and lint without live writes or completion controls.

## Steward refresh correctness (2026-10-18)
- [x] Treat meaningful equivalent transcripts as successful unchanged checks; preserve changed reads with aggregated cautions; 38 focused tests and changed-file lint passed; fictional browser status checks passed.
- [x] Inspect completion/reopen persistence and append-only history only; findings in docs/steward-live-design.md: mutable receipts, best-effort activities, no durable reopen path; no controls, schema changes or live writes.

## Steward live workroom (2026-10-17)
- [x] /modules/steward is now the approved three-column workroom on real data; Team moved to /modules/steward/team; eight tabs consolidated into Meetings / Team / More; /meetings/workroom redirects.
- [x] Verified completion requires status kept AND a current completion receipt; kept-without-receipt shows "Needs verification"; proposals never in the denominator.
- [x] Automatic recent-meeting pull while Steward is open (mount/focus/5 min, deduped) via new member-authorized /api/public/steward/sync; numeric recording_id normalized; zero-transcript calls skipped and retried; closed-browser limit stated in the UI.
- [x] 10 new focused tests pass; 1,921 Steward/domain/data tests pass; typecheck and build OK.
- [ ] Populated visual QA at 1440/768/375 — sandbox has no member session; verified route render/redirect only. Tai's authenticated browser check pending.

## Approved Steward reference implementation (2026-10-17)
- [x] Match approved three-column preview and mobile drawers, retaining fictional-only boundaries.
- [x] Verify 18 focused tests and actual desktop/tablet/mobile interactions/screenshots; 12 desktop rows, mobile first task y=405, no overflow. Hosted access remains blocked by Lovable sign-in; evidence in docs/steward-approved-design.md.

## Steward interactive design preview (2026-10-16)
- [x] Compact characterful task workspace: 12 full rows at 1440×900, 10 at 1366×768, 4 at 375×812; actual meeting switching, AI help, scoring, four preserved receipts and reload reset verified; 17 focused tests and build OK. Hosted review still requires Lovable access.
- [x] Bring actionable tasks into the first 375×812 viewport (task y=586; review action y=756–800), retaining cross-meeting work and proposal/blocked distinctions.
- [x] Preserve append-only illustrative completion/reopen receipts; required reasons, four receipts across two cycles, desktop/mobile browser checks and reload reset passed; 16 focused tests passed.
- [x] Create isolated meeting-first illustrative prototype; no live reads or writes.
- [x] Verify completion/coverage rules and component interaction flow (20 focused tests passed).
- [x] Desktop/tablet/mobile fresh-tab, reload and review/verify/reopen browser checks at 1440/768/375px.
- [ ] Hosted preview review — external preview redirects to Lovable login in the available browser; cannot verify the reported hosted 404 without project-access session.
- [x] Document design direction and preview evidence.

- [x] Add proposed canonical Steward source links, bounded agent run receipts, and policy SQL for Codex.
- [x] Implement bounded on-assignment agent runner and authenticated entry point.
- [x] Show real agent runs and provenance in existing Steward and Home surfaces.
- [x] Complete exact linked Scout task after confirmed Gmail or Resend delivery.
- [x] Add deterministic, adapter, integration, and component tests.
- [x] Document AE1–AE11, SC1–SC9, and evidence boundaries.
- [x] Run focused/full tests, type checks, build, and signed-in checks if available.

## Scout x Steward AI round
- [ ] L1–L4 live AI queue walkthrough — blocked: fresh sign-in link + Codex applying steward_agent_runs
- [x] Campaigns from People rows (C1–C5); storage SQL proposed for Codex
- [x] Steward Scouts tab (D1–D3)
- [x] Scout profile work + Ask AI with company facts (P1–P3)
- [x] Send creates and starts AI follow-up (S1–S4)

## AI execution setup (2026-09-24)
- [x] Archive Codex-applied `steward_agent_runs_and_source_links_hardened` (do not reapply)
- [x] AI runs write via TRUST_TAI_SUPABASE_SERVICE_KEY (external DB only); presence/health on Diagnostics
- [x] Execute authority: no view-only roles; creator/owner or owner/admin only
- [x] Feed write checked; retry reconciles task + feed without rerunning the model
- [x] Team views read status-only run columns
- [x] Live signed-in synthetic run (run fa85bfa4, 2026-09-24)

## Steward workroom corrections (2026-10-17)
- [x] Coverage heuristic removed; score = verified agreed work, capped at 99 unless coverage confirmed + no open proposals
- [x] Receipts require valid timestamp + substantive note; receipt errors surfaced; actual receipt shown in detail
- [x] Approved 18/56/26 layout with compact 56px shell; keyboard-selectable rows; Sheets only at compact breakpoints
- [x] Sync: disconnected source is explicit 503; late-transcript upgrades; added vs refreshed; last-success retained; Retry
- [x] Visual QA via temporary fictional harness (deleted after): 1440/768/375 screenshots, no overflow, drawers verified
