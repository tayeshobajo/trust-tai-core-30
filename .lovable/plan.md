# Two isolated Trust Tai OS mockups

Create two new unlinked mockup routes with local components and inline demo data only. No existing files are edited; no database, migration, or Supabase work.

## Outcomes & Volumes settings mockup

Route: `src/routes/mockups.outcomes-settings.tsx` → `/mockups/outcomes-settings`
Components: `src/components/mockups/outcomes-settings/`

### Page structure
- `AppShell` wrapper, no sidebar.
- Header: title "Outcomes", subtitle "Set the targets. The OS reports against them everywhere else."
- Three stacked `tt-surface` sections.
- Footer: single primary `TTButton` "Save", disabled, with tooltip "Mockup — not wired".

### Section 1 — Commercial Targets (weekly)
Editable rows inside one surface:
- First touches: range inputs `10`–`12`, actual "7 this week", progress bar at 7/12.
- Discovery calls: range `2`–`3`, actual "1 this week", progress bar at 1/3.
- Proposals: range `1`–`2`, actual "0 this week", progress bar at 0/2.
- Run clients: single number `20`, actual "18 this week", progress bar at 18/20.
- Monthly revenue target: currency input `$24,000`, actual "Not tracked".

Each row: label, two small number inputs for ranges (or one for single values), actual value, and a thin progress track.

### Section 2 — Activity Volumes
Editable rows, each with a number input and a cadence select (`per day` / `per week` / `per month`):
- LinkedIn connection invitations: `10` / day, actual today `8`.
- Blog posts published: `2` / day, actual today `0`.
- Scout intro emails: `15` / week, actual this week `0`.

Same progress treatment as section 1. Caption below: "Caps are ceilings. Quality gates decide what actually goes out."

### Section 3 — Scout Messaging
Two-column layout on desktop, stacked on mobile.

Left: template list with 3 mock templates:
- "Roadmap opener" — preview line — last edited "Sep 10" — active toggle on.
- "Local founder" — preview line — last edited "Sep 8" — active toggle on.
- "Post-milestone note" — preview line — last edited "Aug 29" — active toggle off.

Right: editor panel for selected template:
- Subject line input.
- Body textarea (~80 words, mock body, first-person founder voice).
- Read-only "Voice check" chip row: "No em dashes", "No exclamation marks", "No generic check-ins".
- Below editor: "Send window" editable mock fields (weekdays, 8am–6pm CT) and "Weekly cap" `15`.

State: selected template id, local edits to subject/body, toggles local only.

## Scout outreach flow mockup

Route: `src/routes/mockups.scout-outreach.tsx` → `/mockups/scout-outreach`
Components: `src/components/mockups/scout-outreach/`

### Page structure
- `AppShell` wrapper.
- Header: title "Scout Outreach", subtitle "Found by Scout. Written in your voice. Sent by your hand."
- Top-right stat: "This week: 3 of 15".
- Three columns on desktop (`lg:grid-cols-3`), stacked sections on mobile.

### Column 1 — Ready for intro
4 prospect cards:
- Company name, contact name + title.
- One-line fit reason (e.g. "Founder-led, Murfreesboro, just opened second location").
- ICP fit score chip (e.g. "Strong fit" / "Good fit").
- "Draft intro" `TTButton` size sm per card.

Clicking "Draft intro" moves that card into the center column as a new draft.

### Column 2 — Awaiting your approval
Caption at top: "Approve is the send. Nothing leaves without you."
2 initial draft cards, plus any card promoted from column 1.
Each card shows:
- Recipient: name, company, email.
- Template used ("Roadmap opener").
- Full drafted email: subject + ~70-word body, first-person founder voice, specific to the company.
- "Voice check passed" green chip.
- Actions: "Approve & send" primary `TTButton`, "Edit" secondary, "Reject" quiet.

Edit mode: inline subject + body textareas; "Save" and "Cancel" replace action buttons.
Approve moves the card to column 3 with status chips starting at "Sent".
Reject removes the card.

### Column 3 — Sent
3 sent rows:
- Recipient, sent date.
- Status chips in progression: "Sent", "Opened", "Replied".
- One highlighted row: "Replied 2h ago — view in Comms".

State: ready list, draft list, sent list, editing draft id, local edit buffer.

## Shared mockup rules

- All data is inline in the route file or a co-located mock file under `src/components/mockups/`.
- No imports from `src/data` or `src/lib` except `cn` and design-system primitives.
- Allowed imports: `@/components/tt/primitives`, `@/components/tt/app-shell`, `@/components/ui/tooltip`, `@/components/ui/sonner`, `@/lib/utils`.
- Use existing tokens: `tt-surface`, `tt-title-page`, `tt-title-section`, `tt-eyebrow`, `TTButton`, `TTInput`, `TTField`, `MetaPill`, `TonePill`, `SectionHeading`, `TTSelect` from settings pieces, `Toggle` from settings pieces.
- Each route defines its own `head()` with unique title, description, og:title, og:description, og:type, twitter:card, and `robots: noindex`.
- Add `aria-label`s and clear interactive roles.

## Verification

- Typecheck passes.
- Lint on new files passes.
- Build passes.
- TanStack Router auto-regenerates `routeTree.gen.ts` from the new filenames.
- Browser preview at `/mockups/outcomes-settings` and `/mockups/scout-outreach` shows the described sections.
- Confirm no existing files were modified (plan only; build mode will respect the constraint).
