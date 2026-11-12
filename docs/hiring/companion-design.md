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