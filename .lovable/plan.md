# Suite-wide cloud design alignment

Comms already matches the approved direction. The rest of Trust Tai OS still sits on the warm ivory palette with a narrow sidebar and tall marketing-style hero cards. This pass makes the whole suite look like the mockup, without touching product logic, data models, or permissions.

## What changes

### 1. Palette shift: ivory to white + cloud blue
In `src/styles.css`, move the base surfaces from paper/ivory to white and cloud blue, reusing the tokens already added for Comms:
- `--background` becomes the cloud surface (~#F4F8FF), `--card` stays white
- `--secondary` / `--muted` retune to the very light blue (~#EEF5FF)
- `--border` / `--rule` retune to the cloud border (~#DDE5F0)
- `--muted-foreground` to the neutral grey (~#667085); `--ink` stays deep navy
- `--royal` stays the primary blue action colour
Because everything is token-driven, every room inherits the new surface with no per-page edits. `--paper` is kept as an explicit token for the few places that intentionally want warmth.

### 2. Suite sidebar becomes the permanent left rail
`src/components/tt/app-shell.tsx` today is a top header + collapsible nav. Rebuild as a full-height 292px left rail on desktop:
- Trust Tai OS Foundation lockup at the top of the rail, `SUITE` label, then the ten apps
- App name visually dominant, build-state note secondary
- Active state: cloud-blue surface, blue icon, blue marker (already implemented, kept)
- Room-specific slot below the nav (already exists) so Comms keeps its glance/driver/quick-action blocks and other rooms can add theirs later
- The rail scrolls independently of the main column; on mobile it stays a drawer
- Header strip keeps org name, avatar, sign out on the right

### 3. Compact hero for every room
`src/components/tt/app-hero.tsx` is shared by Home, Scout, Roadmap, Projects, Steward, Ops, Pulse, Conductor. Rework it once:
- ~200px tall instead of the current tall card
- mono label, serif H1, one line of supporting copy, primary action on the right
- light cloud wash instead of heavy ambient artwork; ambient per-app accent kept as a subtle tint only
Every room picks the change up automatically.

### 4. Tabs and cards
Normalise `src/components/tt/primitives.tsx` and the tab strips (`scout-tabs`, `comms-tabs`, roadmap/steward/projects tabs) to the thin Fluent underline and the flat white card with a 1px cloud border and minimal shadow, matching Comms.

### 5. Sweep for hardcoded warmth
Search for remaining `bg-paper`, ivory-toned utility usage and per-room gradients, and route them through the new tokens so no stray ivory panels remain.

## What does not change
- No schema, no migration, no new tables. Conversation health stays the derived read model already shipped.
- Comms behaviour, Voice DNA, Connections, drafts, notes, next move, health filters all untouched.
- Room logic, routing, RLS and permissions untouched.
- The composer keeps its honest draft-only authority.

## Verification
- Typecheck plus the full test suite
- Headless signed-in pass over Home, Scout, Comms, Roadmap, Projects, Steward, Pulse, Conductor at 1440px, 768px and 375px, checking contrast, active nav, independent scroll, and that long names and long threads still hold
