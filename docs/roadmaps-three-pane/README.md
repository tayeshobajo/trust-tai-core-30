# Roadmaps three-pane workspace — local review

This is a local-only candidate, based on `865cf68bdf0dc74ee30b6c53339e077002aedde2`. Nothing was pushed, published, imported, sent or changed in production. Comms, homepage, Steward, global tokens and access policies were not edited.

## Preview

On the connected Mac, open **http://127.0.0.1:4339/**. If the server is not running, from this checkout run:

```sh
./node_modules/.bin/vite --config vite.roadmap-preview.config.ts
```

The preview uses eight fictional companies and synthetic messages. It makes no authentication, presence, mailbox, database or sending calls. Its outer shell is a visual fixture using the real Trust Tai logo; the actual Roadmaps component and responsive CSS are shared with the implementation. Fixture edits are explicitly in-memory only. Refresh resets them. The fixtures and preview entry are outside the production application entry graph.

The real route remains behind the existing CMD access gate and uses the existing caller-authenticated canonical readers. Its optional tracker editor uses the existing revision-guarded write API. That API was tested with mocks/synthetic data only; no real Save action was used in QA.

## Implemented

- Persistent desktop relationship queue, conversation and summary panes, five metric cards, scoped identity search, urgency filters, My Assignments and follow-up sorting.
- Selected company survives filters and tab switches. Canonical/public alias deep links, browser popstate and mobile return navigation are supported. Tabs support arrow/Home/End keys.
- Inline chronological escaped message bodies, date dividers, direction, Email/LinkedIn/Sales Navigator, delivery uncertainty, original source links, reviewed-text/redaction metadata, pagination and loaded-message search. Prepared copy stays separate from send evidence.
- Scope changes synchronously hide old text. Stale reads/pagination callbacks, wrong organization/roadmap/relationship pages and conflicting copies fail closed.
- Overdue/due today and existing holds require attention. Upcoming dates show scheduling only. On Track requires a current evidence review, owner, next action, future assigned date and no later correspondence or holds. Imported correspondence now invalidates older reviews too. Missing evidence stays unknown.
- Published roadmap reference and saved workflow status remain separate from correspondence and sales. Verified roadmap cover mappings are reused only when the source URL matches; otherwise a neutral fallback is shown.
- Record an Update and Schedule Follow-up reuse `TrackerEditor`. Existing archive, suppression, bounce and identity holds remain intact.

Send/attachments, Following, internal notes and health overrides are explicitly unavailable. There is no supported Roadmaps dispatch, persisted follow list, append-only note or reviewed health-override API in this candidate. No simulated successful actions were added. The local composer is unsaved prepared text and clears on selection/scope change.

## Verification

Final automated verification passed:

- **134 tests across 14 files**, covering projection/bindings, canonical reads, inline conversations, stale scope, pagination conflicts, drafts, holds, health freshness, tabs, filters, mobile queue/return and tracker concurrency/uncertain-save safeguards.
- Full `tsc --noEmit`.
- ESLint for changed TypeScript/TSX/config files: **0 errors, 0 warnings**.
- Production `npm run build`.
- `git diff --check`.
- Production public/server output scan found no fictional preview company, banner or fixture-message markers.
- Original seven-card patch and original checkout diff both still hash to `5876ba8982362967c2dc030c31034f628558d81753a4c1b20a5bcdc0cca4567f`.

Desktop **1440 × 1000** and tablet **768 × 1024** screenshots were rendered and visually inspected through the supported Chrome controls. Desktop showed all three panes; tablet retained queue/conversation and moved the summary into Details. Tabs, queue persistence and the roadmap fallback were checked in-browser. These observations preceded the final small selection/async/label fixes, which are covered by the final automated gates.

**Outstanding visual gate:** the 375px viewport switch and subsequent browser read timed out. Rebinding, viewport reset and finally browser inventory also timed out. Mobile visual inspection, browser back/forward QA, saved screenshot files and viewport restoration are therefore **not verified**. This was a browser/control connectivity failure, not a permission denial. No production mutation or outbound action was in flight. The responsive mobile queue/selection/return flow passes component tests, but that does not replace visual QA. After reconnecting the Mac/browser, inspect 375 × 812 queue and selected conversation, capture desktop/tablet/mobile JPEGs, check browser back/forward, then reset the temporary viewport.

Build output includes existing TanStack `inputValidator` deprecation notices and generated inherited worker-name metadata. No hosting configuration was changed and no deploy command ran.

Logs are local outside the repository in `../restricted-cmd-mockup-20261104/`: `regression-tests.log`, `types-final.log`, `lint-final.log`, `build-final.log`, `preview-server.log`.

## Precision and capability limits

The actual supplied PNG was materialized, hashed and inspected before coding; see `precision-plan.md`. The exact reference mountain panorama was not found among existing assets. A restrained sunrise gradient is used instead. No replacement mountain image or logo was generated.

Public references retain the existing scoped observation plus the preserved seven-card patch. This work does not claim that the static subset is the full current public directory. The Total Roadmaps card counts distinct authorized saved records, never imported messages or public-only identities. Historical source coverage remains partial.

## Coordination / review boundary

Checkout: `/Users/tayeshobajo/Documents/Codex/2026-10-20/task-2/cmd-roadmaps-three-pane`.

Branch: `codex/cmd-roadmaps-three-pane`.

Shared file: `src/components/tt/app-shell.tsx` adds opt-in `canvas="roadmap"`, a 184px rail and the existing full-bleed/mobile-navigation behavior. Default and workroom behavior are retained. No global design tokens or Comms files changed. `TrackerEditor` only adds an optional initial-field focus prop. Coordinate the small AppShell diff with the separate Comms checkout rather than replacing either worker's file.

The pending seven-card binding changes are preserved as a separate baseline from the new workspace. The prior GitHub 403 was not retried. Publication/push remains outside this task. Before any later release: finish the outstanding browser QA, review this candidate and the seven-card baseline separately, reconcile the latest shared shell/source, revalidate authenticated access and obtain the required publication authority.
