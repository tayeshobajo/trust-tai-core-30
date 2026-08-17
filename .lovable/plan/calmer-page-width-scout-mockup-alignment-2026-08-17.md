# Calmer page width + Scout mockup alignment

Two related changes: give every room a comfortable reading width instead of stretching edge to edge, and bring Scout in line with the reference design.

## 1. A single canvas width for the whole suite

Today the main column in the app shell fills all remaining space, so on a 1480px+ screen the Scout table stretches nearly 1200px wide and the eye has to travel too far.

- Centre the main column with a shared max width of 1280px (`mx-auto w-full max-w-[1280px]`), applied once in the app shell so every room inherits it.
- Register it as a design token (`--container-canvas` retuned to 1280px) rather than a one-off class, so the value lives in one place.
- Remove the per-page `max-w-[1400px]` on Home so it no longer competes with the shell.
- Keep the left rail full-bleed and full-height as it is now; only the content canvas narrows.
- Below 1280px nothing changes — the canvas simply fills available width, so tablet and mobile are untouched.

Result: with the 248-276px rail plus padding, content sits in a comfortable ~1150px reading band with quiet margins on wide screens, matching the proportions in the reference.

## 2. Scout: match the reference layout

Scout currently runs full width with no right rail. Per the reference:

- Two-column workspace: main column (heading, Growth Agent card, tabs, filters, table, pagination) and a ~300px right support rail.
- Right rail carries two cards:
  - **Scout at a glance** — Qualified / In ICP / High potential / Needs review, each with the count and its share of the total, using the counts already derived for the left rail.
  - **Need guidance?** — one short line and an "Open Conductor" link.
- To avoid duplication, the left rail keeps "Your driver" and the Scout settings utility action, and drops its own glance block now that the right rail owns it.
- The right rail collapses below the table at tablet width and is hidden on mobile, where the left drawer still carries the driver and settings.
- Table, status pills, logos, pagination and filters stay exactly as they are.

## What does not change

No schema, services, permissions, ICP logic, or Scout data model changes. No new metrics or invented values — the glance percentages are computed from counts already on the page.

## Verification

Typecheck plus the full test suite, then a signed-in headless pass over Scout, Home and Comms at 1440px and 1280px to confirm the canvas reads calmly and nothing clips, plus 768px and 375px for the collapse behaviour.
