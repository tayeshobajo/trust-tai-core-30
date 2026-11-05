# Soft status treatment

Reference images inspected: libfile_9906e30185648191992d1f1b2d9aede6 (RFP badges), libfile_d412d26d4ae48191b82ea8e69bff707d (Home priorities), and libfile_30a35776286081919d643987ee0988ee (desired RFP mockup).

## Cause and correction

The shared `.cmd-status` rule drew a currentColor outline. Home independently used the same global class for an uncolored uppercase label inside a stretched flex column. Loading the shared system produced the long outlined Home pills; Home styling also leaked uppercase text into RFP badges.

All consumers of this exact treatment are Home priority labels and RFP stage badges (list, detail, next step and related views through RfpStageBadge). The correction removes the decorative stroke, fits the badge to its contents, preserves readable sentence-case text, allows wrapping, and gives Home a semantic shared task badge. Review/waiting is amber, blocked red, delivered green; proposed/planned neutral and active work blue. Existing RFP stage colors/icons remain distinguishable. Home layout styles are separately named so they cannot override shared badges.

Functional control borders, selected-row indicators, active-tab underlines, message focus rings and high-contrast forced-color outlines are preserved. Roadmaps already uses filled status pills; no matching currentColor status stroke was found there. Generic outline badges and Projects' thinner contextual labels were not indiscriminately erased.

## Mockup comparison

The mockup's polish comes from compact sentence-case badges, consistent type size/weight, aligned row metadata, a clear title/issuer hierarchy, pale semantic color fills, quiet one-pixel panel divisions, a restrained blue primary action, and consistent gutters. The current RFP implementation already has the broad three-pane structure and pale canvas but the outlined/uppercase badges and Home's stretched labels disrupt that hierarchy. This patch addresses that concrete shared defect; it does not claim a complete site-wide typography/layout redesign or invent missing business metadata shown in the mockup.

## Verification

36 tests passed in five Home/RFP/design-system files using jsdom, including all semantic color contrast checks. Initial default-environment invocation failed because document was unavailable; the correct jsdom run passed. TypeScript, targeted ESLint and production build passed. Diff whitespace check passed.

Local browser pixels: desktop and 375×812 status catalog with both Home/RFP CSS loaded; all 18 badges have zero border, their original readable labels and explicit fills. Awaiting owner review is 150px wide on desktop, no longer stretched across its column. Mobile document width equals viewport width (375px). Populated real RFP component preview inspected with all stages; no production writes. Preview fixtures are fictional.

## Release state

Separate commit after held Conversations candidate f48fcdf28e04f85fbedcd0ab1edc767381da9abd; no push/deploy performed for this styling patch. Conversations release checks were repeated: 1,361 tests, TypeScript and clean build passed. Production source and live metadata remained a9d22674c5d169a14e95152dab3d6107988a763b before publication attempts.

Automatic approval review denied the Conversations GitHub push, then denied one retry after verifying the existing origin, public repository and authenticated ADMIN access. Exact final reason: "Although the account has admin access, this push publishes application source to a public GitHub repository; deployment approval does not explicitly authorize public source disclosure, so the sensitive egress remains disallowed." Both commands were rejected before execution. No Lovable deployment was invoked, no alternate path used. Explicit approval of public source publication to tayeshobajo/trust-tai-core-30 is required before retrying that action. Separate sync candidate remains untouched.
