# Steward — meeting-first interactive design preview

Preview: `/mockups/steward-next`.

## Current density direction — 2026-10-16, 06:37 UTC

The current preview replaces oversized cards and metrics with a compact homework-style work list. Meeting navigation stays directly above the meeting title. Twelve distinct invented rows demonstrate the actual density: 14px task titles, 12px metadata, 44px action targets and 45px desktop rows. Green rows plus checks mean verified work; amber plus explicit labels mean blocked/overdue or incomplete work; royal plus a flag means a proposal. The score certifies work, never a person's worth. The bottom remark names the remaining evidence and copy/build dependency; proposals remain outside the agreed denominator.

Each row offers a task-specific static AI example (review checklist, recap starter, build order or handover outline) and a path to source/evidence review. It does not call a model or mutate work. Unknown owners and dates remain visible; spoken timing is marked unconfirmed. Existing completion, reason-required reopening and append-only receipt functions remain intact. No AGENTS instructions, older import draft, production routes or shared shell were changed.

### Actual browser evidence

- Normal browser zoom and device scale, no CSS scaling. At **1440×900: 12 fully visible rows**, list y=294–834. At **1366×768: 10 fully visible rows**, tenth row ends y=744; remaining two rows and the bottom remark require scrolling.
- At **375×812: 4 fully visible rows**, first task y=364–465 with both actions visible. Natural vertical scrolling; no horizontal document overflow on any tested size. Navigation and filters scroll within their own bounded horizontal strips.
- Independent actual interactions at all three sizes passed: AI help → source review; evidence-required verification (27→36/100); reason-required reopening (36→27/100); a second completion/reopen cycle retained both proofs and reasons as four ordered receipts with fictional actor and simulated UTC times. Blocked work could not verify or clear an outstanding dependency. Proposals required an owner. Meeting switching showed partial unknown and verified 100/100 separately; cross-meeting work retained the discovery task. Reload reset all changed example state.
- Runtime errors: none. **17 focused tests passed** (11 domain rules, 6 component journeys), including AI support not adding receipts/completion. Changed-file ESLint passed. Harness build reported **build OK at 06:37:06 UTC** after narrow optional-property type fixes.
- Screenshots and geometry/interactions: `/tmp/browser/steward-density/initial-1440.png`, `initial-1366.png`, `initial-375.png`, `ai-1440.png`, `history-1366.png`, and `results.log`; screenshots visually inspected. AI screenshot captured after the opening transition settled.
- Hosted URL: `https://preview--trusttai-os-foundation.lovable.app/mockups/steward-next`. A fresh external browser redirects to Lovable login, so hosted authenticated QA remains unverified. Editor path and local actual-browser QA are verified. No publication, canonical reads/writes, integrations, permissions or sends.

## Direction

One dominant idea: the meeting ended, but its agreed work remains visible until verified. A bounded meeting list provides orientation; the central workspace prioritizes outstanding deliverables, owners and the next move. The alternative All outstanding work view spans meetings without becoming a dashboard grid.

The preview follows the `trust-tai-brand-system` operating law and the existing CMD tokens, controls, logo and typography rather than replacing the current visual system. The Steward ambient identity wash is limited to the orientation band. Green always carries a completion label and check icon. Evidence opens on demand instead of filling the working list.

## Interaction and state map

- Point A: a person returns from several meetings with outstanding promises.
- Destination: every agreed deliverable has a recorded completion reference.
- Stages: proposed → explicitly confirmed with an owner → outstanding/blocked → verified; reopen restores outstanding work.
- Decisions: whether a proposal is agreed work, who carries it, whether a completion reference is adequate.
- Ownership: fictional Alex, Morgan and Sam only; no real assignments.
- Next move: review a deliverable and its source, then record example completion evidence.
- Screens: meeting workspace, cross-meeting work, source/review dialog, future-Fathom explanation.
- Objects: meeting selector, scoped work filters, deliverable rows, evidence/review dialog.
- States: unknown owner, spoken/unconfirmed timing, exact timing, overdue, blocked dependency, proposed, verified, incomplete coverage, genuinely empty filter result.
- Responsive intent: below desktop, a compact meeting selector replaces the stacked meeting cards. Mobile trims the orientation band and removes repeated summary/metrics from the task preamble; cross-meeting work stays one tab away. Filters scroll within their own row. The workspace stays two columns at desktop, and dialogs remain bounded and scrollable.
- Assets: the existing Trust Tai logo in the shared shell. No private meeting imagery or transcript assets.

## Completion integrity

A meeting reaches 100/100 only with complete coverage, at least one agreed deliverable, and proof for every agreed deliverable. Proposals do not enter the agreed denominator. Missing coverage means an unknown score, not 100. Blocked items cannot be verified; their example dependency must be verified before the blocker can be cleared. Verification needs a nonblank reference. Reopen requires a nonblank reason and retains the prior reference and every receipt. Re-completion appends a new receipt, without overwriting earlier evidence. Both event types carry explicitly fictional actors and simulated UTC times. Old proof never counts as current completion after reopening. These are illustrative rules, not new production task lifecycle semantics.

## Boundaries

The prototype imports only invented fixtures and browser-safe pure helpers. All interactions are React in-memory state; reload resets the examples. There is no persistence, real task linkage, Fathom processing, model run, assignment, message, integration activation, permission change or publication. The existing mockup route pattern uses the shared shell without a workspace identity; it never reads real workspace content. The existing separately gated session-import draft now avoids querying teammate task details.

Future Fathom interpretation and authorized assistance are explicitly not connected in this preview. The prototype is not linked into production navigation. Real task confirmation/linkage remains separate future work using the existing task system, not a duplicate tracker.

## Verification — 2026-10-16

- 20 focused tests passed: 8 staged-action rules, 8 meeting completion rules, 4 real component interaction tests.
- Component journey passed: source review → nonblank example evidence → verified result → reopen → remount resets; proposals require owners; blocked work cannot complete; partial coverage and 100/100 remain distinct.
- Changed preview files passed ESLint.
- Harness build/typecheck: build OK at 05:51:39 UTC.
- Local read-only page request: HTTP 200 with rendered Steward heading and fictional-data disclosure.
- Evidence level: component and local SSR proof, not desktop/mobile browser visual proof or production acceptance.
- No production publish, database writes, migrations, assignments, sends or activated integrations.

## Preview availability investigation — 2026-10-16, after 05:53 UTC

- Reviewed application revision: `844b9167200cf1657c2ff9d4634fd3a106ce99a3`.
- The route file and generated route tree both contain `/mockups/steward-next`; no missing/mismatched route was found. No routing or design change was justified by the evidence.
- Fresh browser context and reload at `http://localhost:8080/mockups/steward-next`: HTTP 200, correct Steward title/heading, no app 404 and no runtime errors.
- Desktop (1440px), tablet (768px) and mobile (375px): review → example reference → verify → verified list → reopen passed; no horizontal document overflow.
- Browser screenshots: `/tmp/browser/steward-routing/review-1440.png`, `review-768.png`, `review-375.png`.
- Official hosted preview URL confirmed by the project URL service: `https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/mockups/steward-next`.
- A fresh external browser on that URL redirects to **Log in to Lovable**. It cannot reach the app without a project-access Lovable session. This is not proof that the user's authenticated hosted 404 is fixed. The hosted preview remains unverified; no auth bypass, access change, publication or deployment was attempted.
- Review inside the editor preview at `/mockups/steward-next`, or use Share → Create shared preview link for an independently reviewable private preview. Sharing a preview is distinct from production publication.

## Browser QA corrections — 2026-10-16, after 06:01 UTC

- Reproduced the mobile regression locally at 375×812: the first task heading was at y=1604px.
- After correction, the first task begins at y=586px (heading y=603px); its Review & verify action spans y=756–800px, fully inside the first viewport.
- Actual Playwright interactions passed independently at desktop 1280×1800 and mobile 375×812: complete → require nonblank reopen reason → reopen → complete again → reopen again. Four ordered receipts remained visible, including both prior proofs, both reasons, fictional actor and simulated UTC time.
- Cross-meeting view retained the discovery task; blocked work had no verify action and an uncleared dependency; proposal confirmation required an owner. Reload reset all changed examples and their added receipts. No horizontal overflow or runtime errors on either viewport.
- Screenshot evidence: `/tmp/browser/steward-corrections/first-task-375.png`, `first-task-1280.png`, `history-cycle-2-375.png`, `history-cycle-2-1280.png` (visually reviewed).
- 16 focused prototype tests passed (11 domain rules, 5 component journeys); changed-file ESLint passed. Harness build/typecheck reported build OK. No unrelated suites or older import draft changed.
- Root AGENTS.md prototype additions were reviewed for scope; the new receipt rule applies only to the mockup. Unrelated instructions and the separate session-import constraint remain untouched.
- User-supplied hosted preview: `https://preview--trusttai-os-foundation.lovable.app/mockups/steward-next`. The available fresh external browser still redirects to Lovable login, so hosted authenticated visual QA is unverified. Local actual-browser QA is verified; no access change or publication attempted.