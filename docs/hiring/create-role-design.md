# Approved Create Job editor

Baseline: d1368ad926bb081547adac378a9068b37619b2a7. Reference:
approved-create-job.png. Source-only; no live data or publication.

## Build plan / fidelity

Replace the inline editor with a dedicated Hiring screen, keeping the actual CMD
shell untouched. Match the reference's breadcrumb, editorial heading, grouped
white form cards, 70:30 form/preview columns and compact bottom actions. Reuse
canonical jobSchema, saveJob, owner identities, Button and Lucide. Public rendering
and backend stay untouched. Preserve every field, fixed edit slug and expected
revision. Duplication copies values into a new draft only.

## Precision tokens

- Canvas cloud oklch(0.974 0.012 250); white card/paper; ink foreground
  oklch(0.19 0.048 266); muted foreground oklch(0.46 0.035 262).
- Royal oklch(0.49 0.185 264), accent-foreground on primary actions;
  cloud-line oklch(0.906 0.016 250), cloud-strong icon tiles. Existing tokens only.
- Sora heading 32px/1.2, section 16px/1.4; Manrope body 14px/1.6,
  labels 13px; metadata 12px; zero letter spacing.
- 4px spacing unit; 8/12/16/20/24/32px rhythm; cards 20px padding,
  16px gaps, 8px radius, 1px border; controls >=44px; icons 18px.
- Desktop columns minmax(0,7fr)/minmax(260px,3fr); sticky preview top 24px.
  Detail field pairs at desktop/tablet, single fields at 375px. Preview follows
  form at <=850px; no fixed-height clipping. Existing focus ring/shadow only.

## Component map

HiringWorkspace → RoleEditor (isolated unsaved canonical values, save lock)
→ breadcrumb/back + title/subtitle
→ RoleSection: Role details, Role overview, Responsibilities, Requirements,
  Nice to have, Screening questions, Publishing
→ BulletEditor: add/edit/remove rows (max 20)
→ QuestionEditor: labels, required toggle, move up/down, add/remove (2–3)
→ RolePreview: unsaved identity, metadata, summary, full text, bullets, questions
→ Tips → Save draft / Cancel / Create role or Save changes.

States: validation per field, saving/disabled, success, failed or uncertain save,
explicit read-only reconciliation, changed revision hold, dirty discard confirmation
and browser unload warning. Inputs remain mounted across failed/reload checks.

## Assets / adaptations

Reference is not embedded. Existing Trust Tai logo (src/assets/brand/trust-tai-logo.png)
provides a restrained white/cloud preview identity banner; the reference's abstract
blue wave is unavailable, so no random stock substitute. Existing shell owns its logo.
No unsupported rich-text toolbar: about and bullets persist plain text. Preview has
no apply action. Publishing checkbox is exactly status=open; unchecking selects
Draft, Closed is explicitly selectable, and Save draft always persists Draft.

## Verification plan

Use isolated synthetic fixtures for full field roundtrip/save/reopen, create,
duplicate, revision/slug immutability, preview, status mappings, required fields,
failed/stale/interrupted save, repeated clicks and dirty cancel. Check screenshots
at 375/768/1440 normal zoom, scoped tests/lint and automatic build diagnostics;
never repair the unrelated Studio dependency problem or mutate live roles.

## Completed verification

- Scoped files: workspace.tsx integration, role-editor.tsx, role-editor.css,
  role-editor.test.tsx, Hiring AGENTS.md and this document only.
- Focused command: `bunx vitest run --config /tmp/hiring-editor-checks/vitest.config.ts`;
  final results reported with the commit. Config lives outside source and includes
  existing Hiring domain/provider/intake/presentation/workspace tests.
- Scoped ESLint plus git diff whitespace check. No manual production build or
  typecheck: this environment runs those automatically.
- Latest automatic diagnostics (2026-11-12T21:13:09Z) contain eight existing Studio
  coordinator errors (missing @paperclipai/plugin-sdk and dependent typing errors),
  no Hiring diagnostics. No successful full build is claimed; Studio is untouched.
- Isolated browser flow at 1440/768/375 passed create→Save draft→reopen→Closed
  save→duplicate-as-draft, dirty cancel and fixed slug. Two synthetic saves per
  viewport, zero runtime errors and no horizontal overflow; no backend requests.
- Screenshots: `/tmp/browser/hiring-role-editor/{create,publishing,preview,duplicate}-{1440,768,375}.png`.
  Actual source imported into a temporary localhost fixture; shared shell is not
  reconstructed or changed. Browser screenshots were visually reviewed at each size.
- Fidelity gaps: actual CMD logo replaces unavailable blue wave; full editable
  44px controls and optional nice-to-have section increase height over the small
  reference. Plain text replaces its unsupported toolbar; mobile/tablet preview
  stacks below form. No pretend apply action. Existing public rendering unchanged.