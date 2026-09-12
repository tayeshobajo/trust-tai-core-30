# Pulse Next isolated mockup

Build a standalone `/mockups/pulse-next` prototype that uses illustrative local data and existing Trust Tai visual primitives. Production Pulse, its route, projection logic, data sources, and other rooms remain untouched.

## Experience

- Use the existing Trust Tai shell so the mockup feels native, but keep it unlinked from production navigation.
- Open with a compact Pulse header and freshness line, then place **Needs Tai** immediately beneath it as the unmistakable primary surface.
- Show 3–5 concise decision rows. Each row carries the implication, consequence, owning room/entity, and one mock action without making Pulse appear to execute the work.
- Compress revenue and activity truth into one horizontal **Business pulse** editorial strip with an explicit unreadable-source warning and honest unknown handling.
- Follow with **What the system noticed** as a secondary awareness field: a subdued total, severity filters, four compact groups, observed evidence separated from Pulse’s interpretation, and clear owning-room destinations.
- End with a lightweight recent-movement timeline that supports the read without competing with it.

## Visual treatment

- Pale cloud canvas, warm white editorial surfaces, deep navy type, thin borders, restrained Pulse mulberry and royal accents.
- Avoid nested cards and dashboard tiles. Use ruled rows, subtle section bands, natural-language headings, and only a few compact chips where status must scan quickly.
- Keep the queue and operating read within the first laptop viewport; stack rows and supporting metadata cleanly on smaller screens.

## Technical scope

- Add only new files for the route and mockup-local components/fixtures under `src/routes/` and `src/components/mockups/pulse-next/`.
- Reuse `AppShell`, Trust Tai button primitives, icons, and semantic design tokens; add no backend, schema, production data import, or business logic.
- All controls are local visual-demo interactions only. Actions will indicate their owning room but will not navigate into or modify production workflows.
- Add route-specific noindex metadata.

## Verification

- Check desktop and mobile renderings, including first-viewport hierarchy and stacked row behavior.
- Confirm no horizontal overflow, overlaps, runtime console errors, or inaccessible controls.
- Run TypeScript checking, lint for new files, relevant tests if any, and the project build.
