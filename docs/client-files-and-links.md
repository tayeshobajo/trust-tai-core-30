# Client Files & Links

The client page is the front door to everything about one company's work,
including the parts that live somewhere else: Lovable projects, knowledge
bases, working chats, call recordings, Google Docs and folders of
client-shared assets.

This surface is additive. It does not replace, copy or compete with the two
canonical project stores. Project files (`project_files`) and project-owned
linked sources (`project_thinking_sources`, `project_connections`) are still
read from their owning rooms and still shown once, unchanged, below the new
section. Nothing is duplicated into a second link store.

## Where things live

| Piece | File |
| --- | --- |
| Rules, categories, URL safety, duplicates, filtering, shortcuts | `src/domain/client-resources.ts` |
| Rule tests | `src/domain/client-resources.test.ts` |
| Durable store, server only | `src/lib/client-resources-store.server.ts` |
| Store tests | `src/lib/client-resources-store.server.test.ts` |
| Authenticated route | `src/routes/api/public/clients.resources.ts` |
| Browser data layer | `src/data/clients/resources.ts` |
| Surface and pinned shortcuts | `src/components/tt/clients/resources.tsx` |
| Page wiring | `src/routes/modules.clients.$clientId.tsx` |
| Tab label | `src/domain/client-shell.ts` |
| Proposed schema (NOT APPLIED) | `docs/migrations/proposed/20260918120000_client_resources.sql` |

The tab is labelled **Files & Links** and keeps its `?tab=files` address, so
every existing link still opens it.

## Remaining dependency

`public.client_resources` does **not** exist in project `okydosoacqdnursmmenf`
(verified 2026-09-18 from the app runtime). The reviewed, additive SQL is at
`docs/migrations/proposed/20260918120000_client_resources.sql` and awaits Codex
review and application. No schema was applied from this build.

Until it is applied, the surface reads as explicitly unavailable: "Saved links
could not be read" with the reason that the store is not in this database yet,
and the Add link control is not offered. The adapters, route, store and UI are
fully implemented against the real table, not a mock, so applying the migration
is the only remaining step.

## CR1–CR7 evidence

| Row | What it requires | Status | Evidence |
| --- | --- | --- | --- |
| CR1 | Obvious Add link; repeatable; seven presets; title + URL + category, optional note and meeting date; scope client-wide or one of this client's projects | CODE | `ClientResourcesSection` Add link button; `RESOURCE_CATEGORIES` (7 presets); form fields; scope select defaults to Client-wide and never forces a project |
| CR2 | Multiple of one kind save independently with clear project label; Lovable / KB / Chat pinned on overview with distinct labels; selected project shows its own plus labelled client-wide; All projects groups; search and filter without extra tabs | CODE | `pinnedShortcuts` (all pinned items, scope suffix when titles repeat); `filterResources` (project scope includes client-wide); `groupByProject` (client-wide first); one filter bar, no new tabs; tests in `client-resources.test.ts` |
| CR3 | Durable authenticated services; success only after confirmed save; reload retains; failed save retains text and explains; removal removes reference only; existing files and linked sources intact and shown once; duplicate detection per scope | CODE | Route actions `list/add/edit/remove`; the form clears only after the awaited write resolves; failure sets `problem` and leaves every field populated; `findDuplicate` plus the unique index `client_resources_scope_url`; FilesTab untouched below |
| CR4 | Server/database-side authority and ownership; read-only may open but not mutate; HTTP(S) only, no javascript/data/file or embedded credentials; safe new tab; no provider permission change, no fetching, no "connected" claim; metadata only | CODE | `requireActiveMember` + `canWrite` gate in the route; same-workspace/client/project trigger and frozen-identity trigger in the migration; `checkResourceUrl` in the domain and re-checked in the store; `target="_blank" rel="noopener noreferrer"`; `RESOURCE_TRUTH` copy says links are recorded, not read |
| CR5 | Keep existing upload capability; do not fake upload; asset folders and recording URLs now; no new Drive/Zoom integration; manual category, hints not a whitelist | CODE | Project file upload untouched in Projects; footer states uploading is a separate act on the owning project; `assets` and `meeting_recording` presets; `RESOURCE_CATEGORY_HINT` is advisory only, no domain check anywhere |
| CR6 | White cards, compact labels, responsive, keyboard accessible; useful empty state; a person can add several links across projects unaided | CODE | `TTCard` surfaces, `MetaPill` labels, `grid sm:grid-cols-2` form, labelled selects and inputs, visible `focus-visible:ring-2` on links and actions; `RESOURCE_EMPTY_BECAUSE` names concrete examples |
| CR7 | Tests for persistence, multiples, wrong client/project rejection, read-only refusal, edit/delete reference only, duplicates, invalid URLs, failed-save retention, old Files links; types and build | CODE for rule/store tests and types/build; LIVE pending | 16 tests across the two new files; wrong-workspace and read-only refusals are enforced by the route and the migration trigger and need the applied table for live proof; `?tab=files` preserved |

CODE means proven by tests, types and build in this workspace. LIVE means
observed by a signed-in person against the real database; no live evidence is
claimed here.

## Not done, deliberately

- No schema applied, nothing published, no outbound message sent.
- No Drive, Zoom or Fathom integration added. A recording link is a link.
- No ingestion. Anything that actually reads a source keeps its existing
  explicit action and its readable / unreadable / provenance semantics.
