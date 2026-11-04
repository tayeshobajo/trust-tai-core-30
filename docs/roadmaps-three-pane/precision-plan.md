# Roadmaps relationship workspace — local implementation plan

Reference: Library `libfile_b06147f97df08191a1431db9438258a5`, version 0, `image(20261104-040216).png`, 1536 × 1024, 2,106,429 bytes. Materialized and visually inspected on the consuming Mac. SHA256 `49a7c07a45e1db73e09ed780cfda9ad7cd2711d7e457635aab606445cefe3b85`.

## Source and isolation

Base source `865cf68bdf0dc74ee30b6c53339e077002aedde2`; isolated local branch `codex/cmd-roadmaps-three-pane` in `cmd-roadmaps-three-pane`. The pending seven-card patch is applied here as a baseline, while its original checkout and SHA256 `5876ba8982362967c2dc030c31034f628558d81753a4c1b20a5bcdc0cca4567f` remain untouched. No push, remote write, publication, permissions, credentials, database mutations or outreach. GitHub's prior 403 is not retried.

## Visual tokens and geometry

Use existing Trust Tai Inter typography and brand assets. Main ink `#081225`, muted `#526483`, blue `#155cff`, light blue `#e8f0ff`, line `#e0e7f0`, canvas `#f1f7fe`, white/translucent panels. Reference urgency accents: red `#e63e3e`, amber `#f4aa17`, green `#209c43`, unassessed gray `#98a2b3`; never communicate status by color alone. Sunrise backdrop is a restrained pale-blue/peach gradient while the exact mountain photo is unavailable.

Desktop: existing 64px shell header; opt-in 184px Roadmaps navigation rail; 16px page side padding. Breadcrumb 12px; title 36px/1.1, 700; subtitle 18px/1.4. Five 70–72px metric cards, 12px gaps. Filter/search bar 40px high. Three workspace columns approximate the reference 33% / 47% / 20%, 8–12px gaps; minimums 300px / flexible 420px / 228px. Panels radius 14px, 1px border, subtle `0 2px 8px #10234b08` shadow. Queue rows 74–78px, 18px insets; company names 14px/600, snippets 12px/1.4, status/date 11px. Conversation heading 21px/650; tabs 12px with blue underline; bubbles 12–13px/1.5, 12px radii, outgoing light blue and incoming neutral gray. Pinned next-step strip pale amber. Buttons 36–40px; touch controls at least 40–44px on narrow screens. Focus ring 3px `#75a3ff`, transitions 120ms ease; no decorative animation.

The queue and conversation scroll independently. Header, selected-company tabs, pinned next step and local composer remain visible within their panes. At 768px, keep the queue and conversation, collapse the right panel into the Details tab. At 375px, prioritize the queue; selection opens the conversation with a clear All roadmaps return. Metrics and queue filter tabs scroll horizontally rather than compressing text. Preserve deep links/back/forward and reset private text synchronously when identity/client scope changes.

## Component map

- `AppShell(canvas="roadmap")`: opt-in narrow/full-bleed canvas; other pages unchanged.
- `RelationshipRoadmapWorkspace`: projects existing evidence, maintains scoped selection, filters, tab and local-only draft.
  - `RoadmapMetrics`: canonical saved-record count, known attention/dates and explicit unassessed health. Never substitute 48 imported messages for roadmap total. Public-only unresolved identities remain separately labeled.
  - `RelationshipQueue`: Needs Action / All Roadmaps / My Assignments / Following, scoped identity search, Next Follow-up sort, status text/dot, explicit date, real loaded snippet or “preview not loaded.” Following is unavailable without a persisted source.
  - `SelectedRelationship`: company header, Conversation / Details / Roadmap / Actions & Evidence / Activity tabs; exact stable canonical deep link.
  - `RelationshipConversation`: existing caller-authenticated reader, escaped inline text, chronological date groups, channel/direction/source/precision, loaded-message search, explicit pagination and coverage; no delivery/read ticks.
  - `PinnedNextStep`: saved action/date or honest unassigned/unknown state.
  - `ReplyComposer`: component-local prepared text only; Send and attachments unavailable because no supported Roadmaps dispatch/approval contract exists. Holds remain visible and suppress preparation where appropriate. Never count this text as a draft saved or sent.
  - `RelationshipSummary` and `RelationshipActions`: saved owner/date, latest approved activity and published source. Record an Update / Schedule Follow-up reuse the existing revision-guarded `TrackerEditor` through a route adapter. Internal notes and evidence-backed health overrides are explicitly unavailable until a supported persisted operation exists.
- Pure workspace model helpers classify urgency from `followUpState`, retaining holds and archive states. Newer `importedActivity.latest.at` must invalidate an older health review, in addition to legacy `conversationEvents`.

## Assets

Reuse `src/assets/brand/trust-tai-logo.png`, white variant when appropriate, existing Inter and Lucide icons. Use existing verified roadmap cover mappings only when the source URL matches; neutral “Roadmap preview unavailable” otherwise. The exact mountain panorama in the mockup was not located in the checked checkout inventory: `home/hero.jpg` is arches, `home/roadmap.jpg` is a desert path, `home/projects.jpg` is a stairway, and `public/assets/trust-tai-os-roadmap.png` is a conceptual illustration. Do not substitute these as the alleged reference mountain photo or generate a replacement silently. Use a neutral sunrise gradient and record this fidelity deviation.

## Data, capabilities and guardrails

Reuse `projectEvidence`, the approved identity allowlist, existing canonical/conversation readers, `followUpState`, `editableValues`, tracker edit history and the Roadmaps access gate. No automatic identity merges, new data import or rewritten roadmap copy. Existing conversation summary provides channel/kind/time but no body snippet: unselected queue entries therefore cannot invent a preview. Selected approved reads may supply a scoped loaded snippet.

Future assigned dates do not establish On Track. Current evidence review, reviewer, source, expiry, owner, next action, no later correspondence and no holds are required. No persisted health-override or append-only internal-note API was found in the existing tracker edit contract; disabled actions explain the gap rather than fake success. Following likewise has no saved source. Search is explicitly divided into roadmap identity search and selected loaded-message search, not global mailbox search.

## Build passes and QA

1. Add model rules and fix imported-activity review freshness with regression tests.
2. Implement the persistent structure, semantic tabs and scoped asynchronous conversation pane; reuse existing saved editor via an optional adapter.
3. Apply reference density/tokens and opt-in shell, then tablet/mobile transitions.
4. Build a localhost-only fixture preview with clearly fictional companies/messages, no real mailbox data or live mutation callbacks. No app presence/auth calls from that preview.
5. Test selection/back/forward, queue persistence, tabs, urgency/unknown health, search scope, loading/error/empty states, pagination conflicts, scope reset and stale responses; verify no production/send callback in synthetic QA.
6. Run focused regressions, changed-file lint, full types and production build. Inspect actual preview at 375 / 768 / 1440px, capture synthetic screenshots, restore viewport and report known deviations/capability gaps. No publication.
