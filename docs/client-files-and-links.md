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

| Piece                                                           | File                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| Rules, categories, URL safety, duplicates, filtering, shortcuts | `src/domain/client-resources.ts`                               |
| Rule tests                                                      | `src/domain/client-resources.test.ts`                          |
| Durable store, server only                                      | `src/lib/client-resources-store.server.ts`                     |
| Store tests                                                     | `src/lib/client-resources-store.server.test.ts`                |
| Authenticated route                                             | `src/routes/api/public/clients.resources.ts`                   |
| Browser data layer                                              | `src/data/clients/resources.ts`                                |
| Surface and pinned shortcuts                                    | `src/components/tt/clients/resources.tsx`                      |
| Page wiring                                                     | `src/routes/modules.clients.$clientId.tsx`                     |
| Tab label                                                       | `src/domain/client-shell.ts`                                   |
| Applied schema, record only                                     | `docs/migrations/proposed/20260918120000_client_resources.sql` |
| Storage smoke test                                              | `scripts/qa/client-resources-persistence-smoke.ts`             |

The tab is labelled **Files & Links** and keeps its `?tab=files` address, so
every existing link still opens it.

## Schema status

`public.client_resources` was applied by Codex on 2026-09-18 to project
`okydosoacqdnursmmenf`, from the proposal at 5d6c6de with two amendments, both
now recorded verbatim in the file:

1. The unique index keys on `btrim(url)` rather than `lower(btrim(url))`, so a
   path, query token or document id keeps its case.
2. `EXECUTE` on both trigger functions is revoked from `public`, `anon` and
   `authenticated`.

The file is marked APPLIED and must not be re-applied.

## What is verified, and what is not

Applying the schema is not the same as verifying the feature. Three separate
levels, kept separate:

- **CODE** — proven by tests, types and build in this workspace.
- **STORE-LIVE** — proven against the real table by
  `scripts/qa/client-resources-persistence-smoke.ts` on 2026-09-18, using
  synthetic links on a real client and one real project, every probe row
  removed afterwards (0 left). Observed: client-wide save, project-scoped
  save, two case-distinct addresses both saved, duplicate refused in scope,
  edit keeping scope, read-back, wrong-client removal refused, another
  client's project refused. This proves storage and the workspace bindings. It
  does **not** prove the browser, the route's membership and role gates, or
  anything a person sees.
- **SIGNED-IN** — not performed. This session reports
  `LOVABLE_BROWSER_AUTH_STATUS=no_supabase`: the project uses an external
  Supabase, so no session can be injected or minted here. The signed-in
  add / edit / remove / reload walkthrough, the overview shortcuts, the
  filters, the read-only refusal and the failed-save text retention all remain
  unverified in a real browser and need a signed-in person or Codex.

Route boundary checks that were run without a session (2026-09-18, dev server):
no bearer token returns 401; `null`, an array and malformed text each return
400 without crashing; a valid-shaped body with a non-member token returns 403.

## CR1–CR7 evidence

| Row | What it requires                                                                                                                                                                                                                                   | Status                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR1 | Obvious Add link; repeatable; seven presets; title + URL + category, optional note and meeting date; scope client-wide or one of this client's projects                                                                                            | CODE                                         | `ClientResourcesSection` Add link button; `RESOURCE_CATEGORIES` (7 presets); form fields; scope select defaults to Client-wide and never forces a project                                                                                                                                                                                                                                                                                   |
| CR2 | Multiple of one kind save independently with clear project label; Lovable / KB / Chat pinned on overview with distinct labels; selected project shows its own plus labelled client-wide; All projects groups; search and filter without extra tabs | CODE                                         | `pinnedShortcuts` (all pinned items, scope suffix when titles repeat); `filterResources` (project scope includes client-wide); `groupByProject` (client-wide first); one filter bar, no new tabs; tests in `client-resources.test.ts`                                                                                                                                                                                                       |
| CR3 | Durable authenticated services; success only after confirmed save; reload retains; failed save retains text and explains; removal removes reference only; existing files and linked sources intact and shown once; duplicate detection per scope   | CODE                                         | Route actions `list/add/edit/remove`; the form clears only after the awaited write resolves; failure sets `problem` and leaves every field populated; `findDuplicate` on the canonical address plus the unique index `client_resources_scope_url`; a removal that matches no row in this company's scope is refused with 404, never confirmed; FilesTab untouched below                                                                     |
| CR4 | Server/database-side authority and ownership; read-only may open but not mutate; HTTP(S) only, no javascript/data/file or embedded credentials; safe new tab; no provider permission change, no fetching, no "connected" claim; metadata only      | CODE                                         | `requireActiveMember` + `canWrite` gate in the route; same-workspace/client/project trigger and frozen-identity trigger in the migration; `checkResourceUrl` in the domain and re-checked in the store; `canonicalUrl` normalises only scheme and host, never the path, query or hash; a null or array request body is refused as 400; `target="_blank" rel="noopener noreferrer"`; `RESOURCE_TRUTH` copy says links are recorded, not read |
| CR5 | Keep existing upload capability; do not fake upload; asset folders and recording URLs now; no new Drive/Zoom integration; manual category, hints not a whitelist                                                                                   | CODE                                         | Project file upload untouched in Projects; footer states uploading is a separate act on the owning project; `assets` and `meeting_recording` presets; `RESOURCE_CATEGORY_HINT` is advisory only, no domain check anywhere                                                                                                                                                                                                                   |
| CR6 | White cards, compact labels, responsive, keyboard accessible; useful empty state; a person can add several links across projects unaided                                                                                                           | CODE                                         | `TTCard` surfaces, `MetaPill` labels, `grid sm:grid-cols-2` form, labelled selects and inputs, visible `focus-visible:ring-2` on links and actions; `RESOURCE_EMPTY_BECAUSE` names concrete examples                                                                                                                                                                                                                                        |
| CR7 | Tests for persistence, multiples, wrong client/project rejection, read-only refusal, edit/delete reference only, duplicates, invalid URLs, failed-save retention, old Files links; types and build                                                 | CODE and STORE-LIVE; SIGNED-IN not performed | 24 tests across the two new files; storage smoke test above for persistence, multiples, duplicates, wrong-client removal and foreign-project refusal; route boundary checks for 401/400/403; read-only refusal, failed-save retention and reload are CODE only until a signed-in run happens; `?tab=files` preserved                                                                                                                        |

No signed-in browser evidence is claimed anywhere in this table.

## Not done, deliberately

- Nothing published, no outbound message sent, no external resource fetched,
  no paid lookup. The schema was applied by Codex, not from this build, and is
  never re-applied.
- No Drive, Zoom or Fathom integration added. A recording link is a link.
- No ingestion. Anything that actually reads a source keeps its existing
  explicit action and its readable / unreadable / provenance semantics.
