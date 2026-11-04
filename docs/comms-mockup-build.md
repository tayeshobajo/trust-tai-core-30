# Comms mockup implementation and handoff

Reference: Library `libfile_ba1fa962b0748191a275504e741d8128`, `image(20261104-042225).png`. Downloaded through the supported Library transfer helper, with Library metadata, to `../reference/mockup.png` and visually inspected. First sandboxed transfer failed; one bounded retry succeeded with network permission.

Base: `main` at `968beb6d`, branch `feat/comms-mockup-20261104`, isolated worktree `/Users/tayeshobajo/Documents/Codex/2026-11-03/task-4/comms-worktree`. No commits, pushes, deployment, live-record mutations, or external messages.

## Precision plan and tokens

Preserve all routing, permission-aware navigation, Supabase reads/writes, error/loading states, draft safeguards, attachment handlers and existing review/send workflows. Reuse Manrope/Sora, official logo, Lucide icons and existing royal/ring/status variables. No sample mockup names or messages enter production.

Scoped tokens: reference-blue actions/ring `#174fff` override the existing token names only inside the Comms workspace; lavender `#f2f4fc`, white `#fff`, navy `#101832`, muted `#526078`, border `#dfe4f2`, selected `#e9efff`, incoming `#f0f1f8`, outgoing `#e4edff`, follow-up `#fff6df`. Headings 32px/1.2/700, mobile 26px; panel titles 18px/1.4/700; body 13px/1.5; labels 12px. Existing mono retained only for event provenance/eyebrows. Base spacing 4px, pane gaps 12px, panel padding 16px. Card radius 16px, controls 10px, borders 1px. Shadow `0 4px 14px rgba(42,61,112,.05)`. Existing focus-ring and transition conventions retained.

Refined shell geometry: 184px rail, 56px header, full-width main canvas; separate opt-in `appearance="comms"`. Desktop columns minmax(260px,.95fr), minmax(420px,1.55fr), minmax(260px,.95fr); 32px icon controls; 44px history-view controls. At 375/768px use existing list→conversation navigation, with summary below; at 1440px show all three panes. Tablet negative-margin overflow found and corrected.

## Component map and behavior

AppShell → Comms workspace header/navigation/actions → CommsInbox / ConversationRoom + existing ReplyRecordBar or SendComposer / RelationshipSummary.

- AppShell adds only an optional appearance attribute and stable class hooks. All CSS overrides require the Comms appearance. Default pages retain behavior.
- CommsTabs opt-in view uses Conversations, Accounts & Connections, Voice DNA, disabled Templates, Activity and New Message. Existing Drafts & Reviews and Dashboard destinations remain in the New Message menu. Exact route matching prevents a false active Dashboard state.
- Compact inbox shows All, Needs Action (existing needs_you rules), and disabled Following. Clients/Nurture and health filters remain in the filter disclosure; search/reset/pagination keep existing logic. Accessible row metadata is retained alongside visual status dots.
- Conversation/Files/Notes/Timeline read the same loaded history. Files retains attachment download eligibility; Notes filters only actual note events; Timeline reveals all loaded days. Read failures stay visible in every view. Existing profile, context, interaction and export actions are in the ellipsis disclosure.
- Follow-up callout only renders for a valid recorded followUpDueAt and uses the existing context action. It never invents a completed promise or changes a date.
- Compact ReplyRecordBar moves existing intent choices into a select. Typed words, dirty-state callbacks, Save draft and Prepare draft remain distinct. Existing SendComposer and review gates are unchanged.
- RelationshipSummary reads existing owner/date/stage/email/health fields and uses existing context/profile/interaction callbacks. Missing facts say Unassigned or Not recorded. Last activity is labeled accurately rather than claiming every activity was correspondence.

## Assets and residual differences

Inspected existing home hero/Comms/roadmap/scout/projects assets plus public Comms artwork. They show architecture, a desert path or a terrace, not the supplied mountain panorama. No unrelated stock asset substituted. A neutral lavender/peach gradient remains until a standalone approved mountain image is supplied. Official existing logo and fonts retained.

Residual product/asset choices (not skipped layout work):

1. Mountain hero and matching rail photograph require the approved asset, or approval for a new interpretation. Gradient is the current fallback.
2. Templates, Following, favorites, calling and video calling have no existing corresponding workflow; controls are honestly disabled. Implementing those capabilities requires separate product/data/integration decisions.
3. Composer retains Save draft / Prepare draft / existing review-send gates rather than pretending the mockup's direct Send bypasses approval. Rich formatting/emoji/template insertion is not fabricated.
4. Sidebar destinations remain registry- and permission-derived rather than replacing them with mockup labels or granting new access. Production account data, counts, status reasons and message content will naturally differ from sample content.
5. Relationship quick actions use existing profile/context/interaction flows. A scheduling widget, arbitrary health override, and a fabricated roadmap association were not introduced.

## Roadmaps integration

Read-only inspected Roadmaps worktree `/Users/tayeshobajo/Documents/Codex/2026-10-20/task-2/cmd-roadmaps-three-pane`. Its `canvas="roadmap"` change is untouched. Comms deliberately uses a separate `appearance` prop, so both can coexist without changing the canvas union or Roadmaps predicates. When combining branches, retain both prop definitions and add the `tt-shell-*` hooks to the corresponding existing elements; do not replace the Roadmaps version of AppShell wholesale. Comms overrides require `data-shell-appearance="comms"` and therefore do not affect default, workroom or roadmap appearance.

## Verification

- Production build: `npm run build -- --configLoader runner`.
- Typecheck: `npx tsc --noEmit`.
- Focused Vitest: 31 tests across conversation-room, reply-record, relationship-summary, comms-visual-contract and comms-inbox data. Covers notes/files filtering, retained history errors, earlier history, summary unknowns/callbacks and reply retention.
- Changed TSX lint: zero errors; six existing-pattern warnings (five route hook dependencies and one exported navigation constant fast-refresh warning).
- `git diff --check` clean.
- Real components, AppShell and CommsTabs rendered in the explicitly labeled local test harness at 375x900, 768x1100, 1440x1000. Screenshots in `../screenshots/comms-final-*`. Search, reset, filter disclosure, view switching, failed-save text retention and responsive list→room flow exercised. No live send/save performed.
- Initial build cache restrictions resolved with dependency symlinks and local cache directories; original checkout dependencies were not changed.

## Local preview and remaining QA prerequisite

Component fixture: `npx vite --config .comms-preview/vite.config.ts --configLoader runner`, http://127.0.0.1:4341. Uses real UI components with clearly fictional records and an empty-ID preview identity (presence writes cannot run). Preview-only CSP blocks external connections. It is outside production routes and does not change authentication.

Actual app: `npm run dev -- --host 127.0.0.1 --port 4342 --strictPort --configLoader runner`, then http://127.0.0.1:4342/modules/comms/relationships. Verified that this route fails closed without an authenticated local session.

Pending prerequisite for true end-to-end QA: a legitimate authenticated local session. No credential entry or sign-in initiation is requested as part of this handoff; verify the configured authentication service and allowed callback before proceeding. No auth bypass, copied session token, permission change, or alternate data path was used. Authenticated route screenshots, live attachment retrieval, profile editing, actual draft-save and send/review integration remain unverified; sending is outside this local-only task. This is pending legitimate local login, not a denied action.

Final check results: production build PASS; TypeScript PASS; 31/31 focused tests PASS; changed-file lint 0 errors / 6 warnings; diff whitespace check PASS. Browser document width equaled viewport width at 375, 768 and 1440 after the tablet-margin correction. Final screenshots: `comms-final-375-room.jpg`, `comms-final-768-room.jpg`, `comms-final-1440.jpg`. A test-only misuse of Testing Library's role options was caught by the final typecheck and corrected before the passing run.


Library screenshot delivery: `comms-final-1440.jpg`, confirmed `library_file_id` `libfile_96744e4f8da08191bd4dfe2826ba1c25`, version 0. Fictional preview records only; prominent preview/test-data banner. Upload succeeded and local Library identity was persisted.

Authentication code inspection: the form calls Supabase signInWithOtp (email magic-link flow), with the Trust Tai Supabase origin `https://okydosoacqdnursmmenf.supabase.co`. The local callback is constructed on the trusted current origin, `http://127.0.0.1:4342/auth/callback`, carrying a sanitized relative return path. The canonical fallback is `https://cmd.trusttai.com`. No OTP request, email transmission, credential entry, or session transfer was performed. Backend callback allowlisting and actual delivered-link behavior remain unverified.
