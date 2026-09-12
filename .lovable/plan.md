# Pulse hierarchy and polish pass

## Outcome
Keep the existing production Pulse structure, data reads, and routing behavior while compressing the cockpit so revenue truth and the two action queues are immediately scannable at desktop and correctly ordered on mobile.

## Changes
- Refactor the existing Revenue Ops presentation into one full-width revenue strip: MRR truth and progress on the left, three compact activity meters on the right, with unreadable/unknown states kept distinct from measured zero.
- Recompose the existing Revenue Ops read below that strip into the established two-column layout: recent movement and compact operating notes in the main column; `Needs Tai` and `Captain Watch` as one consistent 320px rail.
- Tighten both queue panels to shared spacing, badges, dividers, and capped item counts. Preserve the existing click-through routes and human-approval wording; add only a quiet view-all route where the underlying destination already exists.
- Keep the existing Pulse header, signal derivation, filters, signal groups, feedback, decisions, and donut summary. Lower their visual priority and place the signal field beneath the cockpit without changing behavior.
- At 375px, render revenue strip → Needs Tai → Captain Watch → movement/notes → signal field. At 1440px, retain full-width revenue followed by main column plus 320px rail.

## Technical boundaries
- Reuse `TodayCommandCenter`, the current Pulse route, Pulse signal components, and existing semantic tokens.
- Change presentation/component composition only. No schema, backend, source, severity, projection, approval, or execution changes.
- Do not hardcode displayed counts; all values continue to come from `RevenueOpsToday` and the existing Pulse projection.
- Keep inaccessible sources explicit (`not readable`, `not connected`, or equivalent), never represented as zero.

## Verification
- Add focused rendering/data-state coverage where practical for readable zero versus unreadable source and queue ordering.
- Run TypeScript checks, changed-file lint, relevant tests, full test suite, and build.
- Inspect `/modules/pulse` at 1440px and 375px when authentication is available; otherwise report the exact visual limitation honestly.
