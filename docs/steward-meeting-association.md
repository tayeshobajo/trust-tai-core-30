# Steward meeting association — preview

## Pre-edit component/token/asset plan
Reuse TaskEditor's native selector, TTButton, existing Sheet drawers, AppShell workroom canvas and container-relative columns. Keep Sora/Manrope, semantic royal/cloud/success/warning/border tokens, existing logo/icons, and the approved compact layout. No new assets or style system.

## Contract
Associate existing business tasks only through a labelled context link to an exact stored conversation UUID. Production links use `https://cmd.trusttai.com/modules/steward/meetings/{uuid}`. Only production or the explicit HTTPS current origin is recognized; no Fathom/title/email inference. Replacing/removing the association preserves other context links and uses the existing revision-checked board update. No automatic task writes or task creation for linkage.

Linked canonical task IDs remain distinct from commitment IDs. Linked task status/evidence is recorded board context, never a commitment receipt. Agreed/verified/proposal scores remain commitment-only. Board loading/errors/capped reads cannot establish complete linked-work coverage. Commitment history is never queried with a board ID.

## Verification
Focused tests: 71 tests across 9 suites passed using Vitest's runner loader and a temporary focused configuration. Changed-source ESLint passed; automatic preview build reports `build OK`. No manual build or typecheck was run.

Fictional shared-component browser QA passed at 1440×900, 768×1024 and 375×812: linked row selection by keyboard, compact task/meeting/Suite drawers, Escape and task focus restoration, local remove/save/relink, and ready/empty/loading/error/truncated states. No horizontal overflow or browser runtime errors. All 23 screenshots were inspected, including the selector and compact detail panels; evidence is under `/tmp/browser/steward-association/`. The temporary browser entry and fixture are removed from the project.

Changed implementation files: `src/domain/{cmd-tasks,steward-workroom,steward-meeting-links}.ts`, `src/data/supabase/cmd-tasks.ts`, and `src/components/tt/steward/{business-task-board,workroom,workroom-view}.tsx`. Tests cover association preservation/removal, duplicate IDs, namespaces, private/foreign/archive exclusion, score invariance, source/evidence isolation, unavailable reads, user/org cache identity and revision conflicts. Documentation: this file, `AGENTS.md`, `roadmap.md`.

Hosted authenticated reads and database persistence were intentionally not exercised: all browser saves were fictional and in-memory, and revision conflicts were tested with mocked transport. No hosted metadata transfer, schema/auth/integration changes, live task writes or publication. Atomic completion remains blocked and untouched.