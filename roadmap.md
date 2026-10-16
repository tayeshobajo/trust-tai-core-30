# Roadmap

## Steward interactive design preview (2026-10-16)
- [ ] Bring actionable tasks into the first 375×812 viewport without losing cross-meeting work or proposal/blocked distinctions.
- [ ] Preserve append-only illustrative completion/reopen receipts; require reopen reasons and verify repeated cycles through desktop/mobile interactions.
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
