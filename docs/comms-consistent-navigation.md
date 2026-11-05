# Comms navigation and workspace spacing — local candidate

Base: 2821a1f17f6556810656ca8339503d8400d1ba87 (latest production source fetched for this task).
Branch: codex/comms-consistent-navigation. No push, deployment, data migration, sync, permission change, or message send.

## Observed problem

Inspected the four user-supplied Library screenshots locally. The first pair and authenticated live read-only navigation agree: Conversations has the new lavender canvas, compact suite rail and Conversations / Accounts & Connections / Voice DNA / disabled Templates / Activity. Connections uses the old shell and Conversations / Drafts & Reviews / History / Voice DNA / Connections. This is a real route-specific inconsistency. The second pair marks the nearly edge-to-edge content on both Roadmaps and Conversations.

## Correction

- One primary navigation everywhere: Conversations, Accounts & Connections, Voice DNA.
- More holds Saved writing and Communication records. Remove Drafts & Reviews and History/Activity as primary tabs and remove the disabled Templates placeholder.
- New Message keeps the existing Message, Email and Proposal intake URLs. Selecting a kind only navigates; existing creation/review/send workflows remain unchanged.
- Common CommsPageShell applies the Conversations appearance, canvas and CSS to Connections, Voice, saved writing, records, and legacy Plan/Inbox/To Scout routes. Voice read-error state retains navigation.
- Keep original /drafts and /history URLs, their search validators and selection callbacks. /review?session= continues redirecting to the same review session in /drafts. Conversation-level drafts/review and Timeline remain unchanged.
- Connections explanatory copy now describes approved sources and coverage rather than implying all mailbox messages are included or making a blanket no-send claim.

## Records and functions retained

Saved writing still uses DraftsWorkspace: unsent comms_drafts plus comms_review_sessions, with existing focused review versions, findings, obligations and approvals. Some proposal/review sessions are not attached to a relationship, so simply deleting their navigation would strand valid work. The secondary menu keeps them reachable without occupying a main tab.

Communication records still uses HistoryWorkspace/listHistory: stored comms_messages and sent comms_drafts, with existing filters, limits and links to the exact conversation. Conversation Timeline remains the per-relationship record. No record readers, approval gates, send functions, database schema or access policies changed.

## Shared spacing proposal

src/components/tt/workspace-spacing.css defines opt-in --workspace-gutter:
- below 640px: 16px
- 640–1023px: 24px
- 1024–1599px: 32px
- 1600px and wider: 40px

--workspace-bottom-space is 24px, increasing to 32px at desktop. Comms consumes both; Roadmaps consumes horizontal gutter only, preserving its viewport-bound panel height and scrolling. Headers, tabs and cards align to the same horizontal content line. Phone Comms tabs wrap so Voice DNA remains visible. RFP files are untouched; the separate RFP design-system branch can adopt these opt-in tokens after coordination rather than receiving a global CSS change.

## Validation

- Full Comms filter: 79 files, 856 tests passed.
- Roadmap component/domain checks: 15 files, 131 tests passed.
- RFP configured suite: 9 files, 80 tests passed.
- TypeScript noEmit passed; production build passed; git diff --check passed.
- Targeted ESLint: zero errors, one existing constants/components fast-refresh warning in comms-tabs.
- Initial review-lessons tests required the dummy TRUST_TAI_SUPABASE_SERVICE_KEY=local-test-only value; createClient is mocked. All full-suite runs then passed. No real production key was used.
- Existing package-lock is inconsistent with package.json, so npm ci fails on the base. Installed manifest dependencies with npm install --ignore-scripts --package-lock=false in this isolated worktree. Did not modify the lock or the other worktree's dependencies. Reproducible lock repair remains a separate release concern.

## Visual verification and limits

Local fictional preview uses the real Comms AppShell, header, tabs and CSS with synthetic body cards; no identity/data calls. Verified desktop 1920px and phone 390px: 40px/16px gutters, no document horizontal overflow, all three main destinations, More → Saved writing / Communication records, and New Message → Email opening the original ?new=email route. Keyboard More/Escape and all intake kinds also covered by component tests. Reload retains the fixture route. This is shared-chrome QA, not authenticated end-to-end testing of the settings forms or stored-message data on the unpublished candidate.

Existing fictional Roadmaps preview uses the real workroom and local in-memory fixtures: inspected desktop and phone screenshots, measured 40px at 1920, 32px at 1280, 16px at 390, no document horizontal overflow. Mobile All roadmaps returns to the queue. No existing data actions were invoked.

Run local previews: npx vite --config qa/comms-navigation/vite.config.ts
- /qa/comms-navigation/index.html
- /qa/comms-navigation/roadmaps.html

Separate sync worktree remains clean at a2978b954be4182c2e0a72ea86ff01d2bb2e7a5b. This candidate does not fix or widen ingestion. Coverage warnings and unresolved obligations are unchanged.

Before release, coordinate with the RFP branch, integrate onto its verified current head without overwriting it, rerun checks, and obtain release authorization for this candidate. Then verify authenticated real desktop/mobile routes, legacy links, coverage warning and settings states. No production data reconciliation belongs in this release.

## Authorized release integration

Integrated completed RFP design-system release 11df8656f7485893a71fb01e9b9a96c9904e02d2 by merge, preserving both histories. No RFP source changes. The earlier proposed stepped spacing scale is superseded: workspace-spacing.css now imports CMD tokens and aliases --workspace-gutter to --cmd-page-gutter (clamp(16px, 2.2vw, 32px)), and --workspace-bottom-space to --cmd-page-block-gap (clamp(20px, 2.4vw, 32px)). This uses the same spacing foundation as RFP without double padding or modifying the shared token values. Parent authorized deploying this styling/navigation candidate; sync reliability remains excluded.

Integrated release checks: frozen Bun install succeeded with unchanged dependency files (the npm-lock mismatch does not block the project's Bun release path); 988 Comms/Roadmaps tests in 94 files and 84 RFP/design-system tests in 10 files passed. Local integrated desktop/mobile pixel inspection confirms shared CMD gutters and no horizontal page overflow. Final clean build and live authenticated verification are recorded in the external release receipt after publication.
