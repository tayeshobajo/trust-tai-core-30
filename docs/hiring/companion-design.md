# Approved Hiring companion screens

Baseline: cd938f2ad5f4f1db5b698ec4c475a06073b52e3a. Source-only, unpublished.
References: roles.png, messages.png, documents.png, visually inspected before implementation.

## Build Plan

**Reference intent:** Searchable role table with status counts and meaningful actions; candidate Messages with conversation/composer and decision context; Documents with real private files and access guidance.
**Fidelity strategy:** Match hierarchy, alignment, whitespace and grouped object surfaces. Use the actual light CMD brand, not a navy redesign. Trustworthy canonical content takes precedence over illustrative reference rows.
**Reuse:** CMD shell, Hiring navigation, candidate header/tabs, Button, Lucide, revision-keyed candidate state, existing RoleEditor and all service contracts.
**Create / modify:** Hiring-only RolesView, PrivateResume access surface, companion styles and focused presentation/interaction tests; compose existing draft/preview/QA handlers into the approved conversation layout.
**Do not touch:** Grouped Create/Edit editor, public careers website, backend/services/schema/access, Studio/RFP, dependencies, live records, email delivery or publication.

## Design tokens

- Colors: existing cloud oklch(0.974 0.012 250) canvas; card oklch(1 0 0) object surfaces; foreground/ink oklch(0.19 0.048 266); muted-foreground oklch(0.46 0.035 262); cloud-line oklch(0.906 0.016 250) borders; royal oklch(0.49 0.185 264), accent-foreground action text. Quiet royal-wash/cloud-strong icon and notice surfaces. No lighter accent body text.
- Typography: actual Sora display, Manrope interface, JetBrains Mono metadata. Existing 36/28px page/person headings, 20/18px section headings, 14px body, 12px metadata, 11px table labels; semibold 600–650, line height 1.4–1.6, zero letter spacing.
- Spacing: 4px base; 8/12/16/20/24/32px rhythm. Desktop workspace 32px, tablet 20px, mobile 16px. Cards 20px (mobile 16px), gaps 16–20px. Table cells 12px 16px. Empty conversation 32px vertical breathing room.
- Geometry: existing 1400px workspace bound, 8px radius, 1px rule, 44px controls. Roles toolbar flexible search plus wrapped status controls. Candidate companions use approximately 66:34 columns with min-width:0; stack below 850px, main content first. Role table horizontally scrollable with keyboard focus on compact screens.
- Effects: existing shadow-card, 180ms color transitions, 3px ring with 3px offset. No ornamental animation or new shadows. Reduced-motion behavior preserved.

## Component map and states

HiringWorkspace → Overview / Candidates / Roles (existing)
→ RolesView(data.jobs, data.applications, edit, duplicate, applications): search/status state, live snapshot counts, semantic table, canonical owner names, application counts, edit/continue, duplicate-as-draft, careers link and publishing guidance.
→ CandidateList(initialRole): existing selector initialized by View applications; all existing filters remain editable.
→ Candidate (same revision key and handlers)
  → candidate header / unchanged tabs
  → Messages: recorded conversation, honest no-sent/no-recorded states, actual status/revision/receipt, blank unsaved draft subject/body, read-only recipient, save draft, saved preview and unchanged explicit QA controls.
  → CandidateContext: applied role, recorded owner/review date, View application; Before sending notice. No extra save/dispatch mechanism.
  → Documents: PrivateResume(app, service), actual HTTPS portfolio link if supplied; private-by-default context.
  → Overview / Activity: original owner/review/audit controls and next-step loop remain.

PrivateResume states: idle, signing/loading, guarded URL available, expired, denied/unavailable/error with explicit retry. Local ephemeral URL only; clear on expiry/unmount, never storage/cache persistence. Existing service supports download-only signed URLs; do not invent a preview endpoint.
Messages: empty/recorded, edited unsaved, saving, saved-preview, failed/stale/uncertain with retained inputs; recorded provider states never inferred from dates. Applicant send action disabled; existing QA buttons remain explicitly human-operated with their existing guards.
Roles: all/open/draft/closed counts from supplied canonical rows, no-match/empty, normal/focus/hover actions. Navigation never writes a role.

## Asset inventory

- Uploaded references are inspection sources only, not embedded app assets.
- Existing CMD logo, shell, fonts and initials are retained. No invented applicant photos or new imagery needed.
- Lucide: Search, BriefcaseBusiness, Pencil, Copy, ExternalLink, FileText, Download, LockKeyhole, MessagesSquare, Info, Zap, UserRound.
- No missing assets require downloads, generation or new dependencies.

## Controlled passes and verification plan

1. Add scoped object components and semantic structure, then connect existing view state/actions.
2. Match desktop spacing, hierarchy and token-based styles without touching the editor or services.
3. Implement compact priorities, access/loading/error/expiry states and empty/recorded conversation distinctions.
4. Test real role filtering/actions, draft save/preview/revisions, guarded documents/retries and preserved editor/access controls using isolated fixtures only.
5. Run all focused Hiring tests and changed-file lint; inspect automatic type/build diagnostics, isolating unrelated Studio failures without repairs.
6. Compare 375/768/1440 screenshots at normal zoom; keyboard and axe checks on isolated local fixtures, no auth/live reads or sends.

## Functional adaptations / risks

- Both real roles remain Open; fixtures/status examples never modify live roles. No unsupported Pipeline/Settings tabs or bulk checkboxes.
- Duplicate opens the existing unsaved duplicate-as-draft editor; explicit save remains required.
- No fabricated subject/body, owner/date, message timestamps, attachments, size/type metadata or upload controls. Only stored résumé name and actually supplied external portfolio are shown.
- The guarded service creates download:true URLs, so Download is supported; inline Preview is intentionally absent. Expiring links must be requested again, never cached persistently.
- Public careers link opens the existing website unchanged; Open starts intake only after explicit save. Draft/Closed intake is off and existing records remain.
- Shared shell is not reconstructed by synthetic QA. Hosted/publication and live-data checks are outside this scope.

## Completed / verification

- Matched: role search/status table and paired guidance; candidate conversation/composer and two context cards; private document rows and privacy guidance. Preserved actual CMD typography/colors, grouped editor, Overview/Candidates tabs and all canonical services.
- Intentionally adapted: no fake Pipeline/Settings/bulk/upload controls; no sample recipients/messages/files/dates/sizes; no inline résumé Preview because the existing guarded service is download-only. Initials replace fictional portraits. Compact tables scroll with keyboard focus; compact companion context follows the primary content.
- Existing donut Applications label now explicitly uses foreground. Keyboard-focusable role table and role-editor aside checked. Mobile long résumé names wrap in a full-width text track above the download action, rather than compressing beside it.
- `bunx vitest run --config /tmp/hiring-companion-checks/vitest.config.ts`: exit 0, 75 tests across seven files. Includes all 23 preserved editor tests, 18 new companion tests, workspace/presentation/domain/provider/intake tests; mocked/local fixtures only, no provider calls.
- `bunx eslint src/components/tt/hiring/{companions.tsx,companions.test.tsx,views.tsx,workspace.tsx,workspace.test.tsx,role-editor.test.tsx}`: exit 0. `git diff --check`: exit 0.
- `python3 /tmp/browser/hiring-companions/check_companions.py`: exit 0. At 375/768/1440, no page overflow or runtime errors; axe has zero violations on Roles/Messages/Documents after navigation transitions settle. Checked role filters/application routing, human draft save/read-back/preview, readonly recipient, disabled applicant send, denied download/retry, and retained editor Open status/focus. Each isolated run recorded one synthetic draft save, two synthetic signing requests, zero sends, zero role saves. No authentication restored and no external requests allowed.
- Screenshot directory: `/tmp/browser/hiring-companions/`. Files at each width 375/768/1440: `roles-{width}.png`, `messages-empty-{width}.png`, `messages-saved-{width}.png`, `documents-{width}.png`, `documents-denied-{width}.png`, `documents-ready-{width}.png`, `preserved-editor-{width}.png`. Browser results: `results.json`; execution log: `browser.log`.
- Actual automatic diagnostics at 2026-11-12T21:43:41Z show eight errors exclusively in `packages/studio-research-coordinator`: missing `@paperclipai/plugin-sdk` in host-admitted-routes/manifest/plugin/preview-bootstrap/signed-routes; implicit-any ctx/context; unknown verified.expiresAt. No Hiring/app errors reported. The checker does not expose an exit code or separate app-only result; full production-build success is not established. Manual build/typecheck is prohibited by the environment, so neither was rerun. Studio/dependencies were intentionally untouched.
- Existing `/modules/hiring` metadata was inspected and already supplies app-specific title, description, Open Graph type/title/description and Twitter card; no route edits needed.
- Known review boundary: synthetic QA imports real Hiring components/styles but does not reconstruct the shared shell or download externally hosted font files. Shared shell/fonts remain unchanged. No real applicant/job records read or changed, email sent, SQL/access/configuration modified, or publication performed.

## Exact changed files

- `src/components/tt/hiring/companions.tsx`
- `src/components/tt/hiring/companions.css`
- `src/components/tt/hiring/companions.test.tsx`
- `src/components/tt/hiring/workspace.tsx`
- `src/components/tt/hiring/views.tsx`
- `src/components/tt/hiring/workspace.test.tsx`
- `src/components/tt/hiring/role-editor.test.tsx` (existing Edit selector updated for the role-specific accessible name only)
- `src/components/tt/hiring/AGENTS.md`
- `docs/hiring/companion-design.md`
- `AGENTS.md` (presentation-boundary rule only)
- `roadmap.md` (requested-task tracking only)

Skill shaping reference comparison: mockup-to-build-precision. No plan file created or changed.