# Comms workspace mockup v2 — one workspace, review as the hero

MOCKUP ONLY. Route: `/mockups/comms-workspace-v2`. Sample data and local React
state only. No Supabase read or write, no model call, no provider contact, no
production Comms route, component, approval authority or send path is touched
by anything in this prototype.

## Why v2 exists

Tai rejected directions A, B and C. The audit was accurate:

- A and B were nearly the same design; all three reused one long `ThreadPane`
  and a stack of bordered `Surface` blocks.
- The suite rail sat blank and wide, so the actual work had no room.
- Status was repeated in the summary line, the list row, the thread header and
  the body.
- A large "My read" block preceded the editor and restated the client's
  questions instead of revealing judgment.
- Relationship facts sat far below the work.
- Review — the actual product — was a button, never a rendered state. No
  line-level review appeared in the visual story at all.
- The composer required page scrolling.

The Adaeze fixture is the hero case: the source asks four things and the draft
answers them badly. v2 is built so that case is the first thing a person sees
working.

## Product intent held in this mockup

Comms helps the team understand a client's goal, prepare an accurate response
in Trust Tai's voice, see grounded opportunities, and seek human approval.
It accepts email, pasted WhatsApp/LinkedIn text, and proposals written outside
Comms. Founder judgment shows up as a few useful decisions, not an essay.

## Token block (from `src/styles.css`, unchanged)

| Purpose | Token |
| --- | --- |
| Outer canvas | `--cloud`, `--cloud-strong`, `--cloud-line` |
| Work surface | `--paper` (pure white) / `bg-card` |
| Text | `--ink` / `text-foreground`, `text-muted-foreground` |
| Primary action, highlight anchor | `--royal`, `--royal-wash`, `--royal-wash-strong` |
| Dividers | `--rule` / `border-border` |
| States | `--danger`, `--warning`, `--success`, `--ember` |
| Body type | Manrope (`--font-sans`), 14–15px |
| Restrained headings | Sora (`--font-display`), title 20–24px |
| Reading type | draft and source 15–16px, metadata ≥12px |

Spacing 4px base, gaps 8/12/16/24. 1px dividers. Radius 8–12px at major
surfaces only; no bordered card nested inside a bordered card. Buttons 36–40px
desktop, ≥44px touch. Lucide icons 18–20px. Transitions 150–180ms with
`motion-reduce` fallbacks. No gradients, glass, or decorative graphics. Logo
reuses the existing `BrandLogo` asset. No serif anywhere.

## Layout contract (1440×900)

```text
+----+------------------------------------------------------------------+
| 64 |  Comms toolbar 56px: name · search · [New review] · Settings      |
| px +--------------+---------------------------------------------------+
|rail|  list 300px  |  work pane, min 600px, fills remaining width       |
|    |  (scrolls)   |  (scrolls independently)                           |
+----+--------------+---------------------------------------------------+
```

- The rail is a faithful mockup-local replica of the suite rail in its
  collapsed 64px state, with a real expand control. It is never a blank
  240px column labelled SUITE.
- Workspace fills the viewport beneath the shell. The page itself does not
  scroll; the list and the work pane scroll independently.
- 24px outer gutters, 16–24px pane padding.
- In review mode the list collapses and a breadcrumb returns to the thread.

## Component map

| Component | File | Responsibility |
| --- | --- | --- |
| `MockCommsShell` | `shell.tsx` | Collapsed/expandable suite rail replica, 56px Comms toolbar, prototype marker with disclosure |
| `WorkList` | `work-list.tsx` | One row per thread, filter control (All / Needs reply / In review / Waiting), "Needs attention" due follow-ups as list items |
| `ConversationWorkspace` | `conversation.tsx` | Single header, "Earlier messages · n" on demand, editable working goal, compact next step, reply editor, Add context vs Attach |
| `ReviewIntake` | `intake.tsx` | "What are we responding to?" + "Your draft", recipient and goal, context files vs outgoing attachments, honest unread PDF |
| `DraftReviewWorkspace` | `review.tsx` | Focus mode: draft ~62% / notes ~38%, version + approval state machine |
| `AnchoredDraftEditor` | `review.tsx` | Highlighted anchors with margin markers, click-to-select both ways, keyboard reachable, editable in place |
| `ReviewNotes` | `review.tsx` | Findings / Coverage / Source tabs, prioritized findings, Accept · Edit · Keep |
| `ContextDrawer`, `RelationshipDrawer` | `drawers.tsx` | Source material and relationship memory on demand |
| `ApprovalFooter` | `review.tsx` | Review draft · Request approval · Approve · Approved for this version |
| Fixtures | `src/data/mockups/comms-workspace-v2.ts` | All sample content, invented |

## State model (local only)

`view`: `conversation` | `intake` | `review`.
`draftText`, `version`, `dirty`, `reviewState`: `none` | `running` | `complete`
| `stale`, `approval`: `none` | `requested` | `approved`, `role`: `member` |
`reviewer`, `findingDecisions`, `selectedFindingId`, drawers.

Rules encoded: accepting a change rewrites the draft, bumps the version and
invalidates the review; keeping a must-fix cannot produce readiness; any typed
change immediately invalidates a visible ready or approved state; "read the
review" is never presented as approval; Approve is only offered to the
authorized-reviewer demo role; send is simulated and contacts nothing.

## Demo states covered

1. Default conversation (Adaeze) with a saved draft and one next action.
2. Standalone New review: pasted context + pasted proposal draft + an
   unsupported PDF attached as context, reported unread.
3. Focused review with a finding selected and its exact source evidence.
4. Corrected draft → review changes → request/approve → edit invalidates.
5. Private opportunity kept for later, never written into the client draft.
6. Missing context / unsupported attachment → honest incomplete review.
7. Team member vs authorized reviewer affordances, labelled demo roles.

## Visual acceptance evidence

Rendered and inspected at three widths from the running prototype.

| Viewport | Screenshot | Result |
| --- | --- | --- |
| 1440×900 conversation | `/tmp/browser/comms-v2/desktop-conversation.png` | Toolbar, list, single thread header, working goal, reply editor and **Review draft** all visible without page scroll; no summary or relationship card above the editor. |
| 1440×900 review, finding selected | `/tmp/browser/comms-v2/desktop-review-finding.png` | List collapsed, draft pane central with anchored highlight on the selected sentence, margin marker aligned, notes pane showing "3 issues to resolve", coverage reading "2 of 4 addressed". |
| 1440×900 coverage open | `/tmp/browser/comms-v2/desktop-coverage.png` | Four source questions with answered / missing / pending state, each linking to its source passage. |
| 768×1024 | `/tmp/browser/comms-v2/tablet-review.png` | List becomes a drawer; draft keeps reading width; notes toggle below the draft rather than stacking every section. |
| 375×812 review | `/tmp/browser/comms-v2/mobile-review.png` | Focus navigation with Back; notes open as a bottom sheet tied to the selected passage; actions sticky above the keyboard-safe area. |

Honest gaps, stated rather than implied:

- Everything is simulated. No review model runs, no record is written, nothing
  is ever sent. This is not production-verified in any sense.
- Highlight anchoring matches on the current sentence text, so a rewritten
  sentence drops its anchor by design rather than drifting to the wrong words.
- Attachment parsing is sample behaviour only: text and Markdown show content,
  PDF and images are reported unread and are never treated as read.
