# Comms white-card cleanup

## Reference intent

Use the Trust Tai OS sign-in email as the surface reference for the five real
Comms destinations. The application remains an operational workspace, not an
email layout: a pale blue OS canvas carries opaque white working surfaces with
fine cool-gray rules, readable navy type, restrained royal actions, and pale
blue only for selected or contextual states.

The cleanup changes presentation and concise interface copy only. Existing
records, counts, filters, deep links, save and dirty-state protection, review
authority, approval boundaries, connection reads, authentication, and delivery
logic remain unchanged.

## Design token block

These values come from `EMAIL_COLORS` in `src/brand/brand-contract.ts` and its
screen-token sources. They are targets for the existing semantic tokens, not
new component-level literals.

### Color

- Canvas: `--secondary` / email `#e9f4ff`; the existing OS background remains
  `--cloud` where the shell already uses it.
- Primary surface: `--paper`, `--card`, `--surface-primary`, and
  `--surface-secondary`; email `#ffffff`.
- Primary text: `--ink` / email `#0a1229`.
- Supporting text: `--muted-foreground` / email `#4d586c`.
- Rules: `--rule`, `--border`, and `--cloud-line`; email `#d8e1ea`.
- Primary action and focus: `--royal` / email `#2755c7`.
- Contextual notice and selected row: `--secondary` at full opacity. Do not use
  transparent blue as the resting background of primary cards.
- Status colors keep their existing semantic tokens and always retain a text
  label.

### Typography

- Preserve the OS families: Sora for headings, Manrope for body/interface, and
  JetBrains Mono for compact metadata.
- Compact page title: 26 to 32px, rather than the current 36 to 48px room hero.
- Section headings: 18 to 20px, medium or semibold.
- Ordinary body and controls: 14 to 16px.
- Metadata: 12 to 13px with `--muted-foreground` contrast; reserve 10 to 11px
  mono text for truly technical identifiers, not ordinary explanations.
- Letter spacing remains zero for ordinary copy. Existing eyebrow tracking is
  retained only for short labels.

### Spacing and geometry

- Primary card radius: 16px (`rounded-2xl` with the current 12px base radius).
- Card border: 1px solid `--border`.
- Card padding: 20 to 24px desktop; 16px mobile.
- Section and card gaps: 16 to 24px.
- Controls retain at least 44px touch targets where they are primary mobile
  actions.
- Dashboard cards size to their own content. Grid rows must not stretch a short
  card to the height of a longer neighbor.

### Effects

- Primary cards are opaque white.
- Remove ambient gradients and translucent resting surfaces from Comms primary
  work areas.
- Use no glass or backdrop effects.
- Use no decorative shadows. Existing card shadow is removed from the Comms
  surface treatment; borders and spacing provide separation.
- Keep existing focus rings and reduced-motion behavior.

## Component map

```text
Comms route
├── AppShell (reuse unchanged)
├── CommsPageHeader (new compact shared presentation)
├── CommsTabs (reuse behavior; refine mobile layout and menu surface)
└── Destination workspace
    ├── Dashboard
    │   ├── ActionSection cards
    │   ├── bounded record previews
    │   └── exact-total / View all footer
    ├── Conversations
    │   ├── CommsInbox white list pane
    │   ├── ConversationRoom white working pane
    │   ├── contextual selected rows and notices
    │   └── existing editor, review action, and mobile pane switch
    ├── Drafts & Reviews
    │   ├── white queue pane
    │   ├── white intake or draft pane
    │   └── white review workspace with restrained internal dividers
    ├── Voice DNA
    │   ├── white current document/editor
    │   ├── white rules and passage-check panels
    │   ├── white review-history panel
    │   └── explicit view-only, current, editing, and unsaved states
    └── Connections
        ├── white account/sync cards
        ├── white review/runtime cards
        └── existing retry and refresh controls
```

Reusable behavior remains in `TTButton`, form controls, `MetaPill`, query
states, review components, and the relationship room. A Comms-specific surface
class/component is justified because changing the global `tt-surface` or
`PageHeader` would unintentionally redesign every other OS room.

## Asset inventory

- Trust Tai lockup: reuse the existing official bundled shell asset. No new or
  re-created logo.
- Icons: reuse the existing Lucide set and current Comms icons. No new icon
  family.
- Fonts: reuse Sora, Manrope, and JetBrains Mono already loaded by the OS.
- Images and illustration: none required. The email is a surface-style
  reference, not a request for new imagery.
- Missing assets: none.

## Responsive plan

- At 375px, keep the five destinations and New draft reachable without
  horizontal page overflow; the tab row may scroll within its own region.
- Conversations retain the existing list-to-room focus flow rather than
  stacking both panes.
- Draft queue and focused work stack at narrow widths, with the chosen task
  before supporting detail when a selection is active.
- Proposal fields and review findings remain readable without clipped actions.
- At 768px and 1440px, white panes retain stable widths and independent content
  height. Dashboard cards use a masonry-like two-column flow rather than shared
  row heights.
- At 1440 by 900, the compact title and navigation leave the first useful work
  visible.

## Acceptance and evidence

- D01-D06: verify through focused component/domain tests, type checking, build,
  and screenshots at 375, 768, and 1440 where the preview is accessible.
- D07: a signed-out workspace gate or fixture screenshot is labelled partial
  evidence only. Full visual sign-off requires actual signed-in Dashboard,
  Conversations, Drafts & Reviews, Voice DNA, and Connections screens.
- D08: record changed files, intentional deviations, commands, exact preview
  environment/build, and any remaining signed-in verification blocker here
  after implementation.

## Scope boundaries

- No schema or migration application.
- No production publication.
- No provider send or client communication.
- No changes to authentication, database access, counting rules, review
  authority, delivery authority, or canonical C/P/T acceptance IDs.
- Visual completion does not imply Comms 100% functional acceptance.