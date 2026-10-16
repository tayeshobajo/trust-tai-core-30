# Steward — meeting-first interactive design preview

Preview: `/mockups/steward-next`.

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
- Responsive intent: meeting list becomes three columns at tablet size and a vertical list at narrow mobile size; workspace becomes two columns only at desktop. Controls wrap, text can break, and modal height is bounded with scrolling. Browser visual checks were subsequently authorized and passed at 1440/768/375px.
- Assets: the existing Trust Tai logo in the shared shell. No private meeting imagery or transcript assets.

## Completion integrity

A meeting reaches 100/100 only with complete coverage, at least one agreed deliverable, and proof for every agreed deliverable. Proposals do not enter the agreed denominator. Missing coverage means an unknown score, not 100. Blocked items cannot be verified; their example dependency must be verified before the blocker can be cleared. Verification needs a nonblank reference. Reopen clears the reference. These are illustrative rules, not new production task lifecycle semantics.

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