# Comms white-card cleanup

## Build Plan

**Reference intent:** Apply the sign-in email’s opaque white card language to the five real Comms destinations while preserving the application’s workspace structure and behavior.

**Fidelity strategy:** Brand-consistent interpretation. Match the email’s exact palette and surface character, but keep Comms as a compact operational workspace rather than stretching it into an email layout.

**Reuse:** Existing Trust Tai logo, Sora/Manrope/JetBrains Mono type, semantic color tokens, buttons, status labels, Comms queries, filters, deep links, editors, review controls, retry controls, and mobile focus behavior.

**Create / modify:**
- Add a compact shared Comms page header and an opaque white Comms surface treatment.
- Refine the five-tab row and New draft menu for narrow screens.
- Rework Dashboard cards into independent content-height columns, preserve exact totals, and add useful bounded previews and filter-carrying View all links.
- Restyle Conversations, Drafts & Reviews, Voice DNA, and Connections with white primary panes, restrained pale-blue selection/notices, readable type, and fewer nested borders.
- Shorten implementation-heavy copy where meaning is preserved.
- Add focused visual-contract tests and document verification evidence.

**Do not touch:** Database/authentication logic, counting rules, canonical records, review/approval/send authority, existing C/P/T acceptance IDs, schema, production publishing, or provider delivery.

**Design tokens:**
- Colors: paper/card `#FFFFFF`, calm wash `#E9F4FF`, ink `#0A1229`, rule `#D8E1EA`, royal `#2755C7`, muted `#4D586C`, all through existing semantic tokens.
- Typography: existing OS families; 26–32px compact page titles, 18–20px section titles, 14–16px body, 12–13px metadata.
- Spacing: 16–24px gaps; 20–24px desktop card padding and 16px mobile padding.
- Geometry: 1px border, 16px primary-card radius, content-sized Dashboard cards.
- Effects: opaque white, little or no shadow, no gradients or glass in Comms primary work surfaces.

**Component map:** AppShell → compact Comms header → CommsTabs → destination-specific white-card workspace. Existing query, editor, review, status, and retry components remain authoritative.

**Asset inventory:** Existing Trust Tai logo, existing Lucide icons, existing OS fonts. No new imagery or recreated assets.

**Responsive plan:** Preserve mobile list-to-room focus in Conversations, stack focused Draft work before support, keep tabs/New draft reachable without page overflow, and verify 375px, 768px, and 1440px. At 1440×900, first useful Dashboard work remains visible.

**Risks / assumptions:** Signed-in browser access is not currently injected in this environment. Signed-out captures can verify the gate only and will not be counted as full-screen sign-off. No records will be created or changed for visual QA.
