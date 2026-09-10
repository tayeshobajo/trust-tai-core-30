# Scout Smart Import (P4-01 correction)

Replace the generic CSV importer doorway with **Smart Import**: hand Scout a source, Scout reads it, extracts candidate companies with the shared intelligence runtime, and returns a staged set a person reviews before anything is saved.

No P4-02, no P5, no percentage movement. Mockup first, no code this turn.

## 1. What already exists and gets reused

- **One reasoning boundary**: `src/lib/intelligence-runtime.server.ts` (`runtimeModelCaller`, `extractJsonObject`, typed provider failures). Rooms are forbidden by CI (`intelligence-runtime-boundary.ts`) from touching providers directly, so extraction must go through this. No new per-feature model.
- **Streaming AI route pattern**: `src/routes/api/public/scout.discover.ts` already does bearer-token + membership fail-closed auth and NDJSON stage streaming. Smart Import copies that shape.
- **Canonical store**: watchlist membership is a marker in `prospects.metadata.scout_watchlist` (`src/data/scout/watchlist.ts`), with `watchlistSourceKey` replay keys and activity events. No second store, unchanged.
- **Staging model**: `StagedCompany` / `StagedState` in `src/domain/scout-watchlist.ts` and the review UI in `src/components/tt/scout/watchlist.tsx`. Smart Import feeds the same staged review, it does not build a parallel one.
- **CSV/TSV parser**: `parseDelimitedRows` / `parseWatchlistImport`, kept.
- **Google auth today**: the only Google OAuth in the project is Gmail (`comms-gmail.server.ts`, `comms_integrations`), Gmail scopes only. There is **no** Drive/Docs/Sheets connection, and no `google_drive` workspace connector is available to this project. We will not invent Drive access.
- **Runtime limits**: the server runs on a Worker; no PDF/DOCX library is installed and native ones cannot run there.

## 2. Recommended Smart Import flow

1. Watchlist header action becomes **Add from source** (Smart Import). **Add company** stays first-class next to it.
2. One panel, three doorways: **Upload a file** · **Paste a link** · **Paste text**.
3. Scout first says what it can read: file name/type or resolved link kind, plus an honest refusal line when it cannot read it. Nothing is sent anywhere on selection.
4. Person presses **Read this source**. Only then does the source text leave the browser, to `POST /api/public/scout/import` (bearer token + membership verified server-side).
5. The route extracts text, then calls the runtime once with a strict JSON response format, streaming stages: `reading source` → `extracting companies` → `checking against the board`.
6. Response is staged candidates only. Duplicates are computed against the canonical prospect store, rows are marked `new` / `duplicate` / `unreadable`.
7. Person reviews: edit name/website/note, remove, keep, then **Save N to watchlist** through the existing `addToWatchlist` path with actor/time provenance and replay key.
8. Discard leaves no durable trace: no source text, no extraction, no row.

## 3. Source types: v1 vs later

**v1 (feasible now, text-readable)**
- Pasted text (prose or list).
- Uploaded `.csv`, `.tsv`, `.txt`, `.md` (read in browser as text).
- **Public / "anyone with the link"** Google Sheet: server fetches the sheet's CSV export endpoint.
- **Public / "anyone with the link"** Google Doc: server fetches the doc's plain-text export endpoint.
- Public web page or plain-text file URL: server fetches and strips to text (same-shape fetch, size-capped).

**Later (named, not faked)**
- Private Google Docs/Sheets/Drive files: needs a Drive-scoped connection. None exists. Path: add Drive scope via the existing connector infrastructure or a new in-app Google connection, as its own slice.
- PDF: needs a pure-JS, Worker-safe extractor (e.g. `unpdf`); an added dependency, so it is its own decision.
- DOCX: needs a Worker-safe unzip + XML text pass (e.g. `mammoth`/manual); same.
- `.xlsx` / `.numbers` / `.ods` workbooks: still refused honestly with "export as CSV".

Every not-yet-supported source is refused in words, never silently parsed as garbage.

## 4. Smallest data/state changes

- **No schema change. No migration. No new bucket.** The source is transient; only saved companies persist, exactly as today.
- New in-memory/domain types only:
  - `SmartImportSource` = `{ kind: "file" | "link" | "text"; label: string }` (label is filename or link, shown on the banner, never stored).
  - `ExtractedCompany` extends the existing staged row with `confidence: "observed" | "inferred"`, `because: string`, `excerpt: string` (verbatim snippet from the source), and per-field inference flags for website/name.
  - `StagedCompany` gains optional `extraction?: ExtractedCompany` so the existing review UI can show evidence without a new store.
- New modules: `src/data/scout/smart-import.ts` (pure: prompt shape, response verification, grounding check, duplicate marking), `src/lib/scout-import.server.ts` (source fetch + runtime call), `src/routes/api/public/scout.import.ts` (auth + stream).

## 5. Trust and provenance rules

- Extraction is **grounded**: every returned company must carry an excerpt that actually appears in the source text. A row whose excerpt is not found is dropped with a reason, never reshaped (same discipline as `verifyRuntimeRead`).
- A website not literally present in the source is marked **inferred**, shown as inferred, and never auto-completed into a domain guess.
- Unknown is never zero: missing website stays empty with "no website found in the source", not a fabricated one.
- Nothing is durable until explicit save. Save writes the existing watchlist marker with actor, time, method `import`, and the replay key.
- The source itself does not become memory. If we later want it attached, it goes through the existing canonical source/file rule, as a separate decision.
- No research, no scoring, no outreach is triggered by importing.

## 6. Mockup specification

**Panel: Add from source** (opens in place, above the watchlist table)

- Title `Add from source`, sub-line `Scout reads what you give it and shows you what it found. Nothing is saved until you save it.`
- Three stacked doorways, equal weight, soft-blue bordered cards:
  1. `Upload a file` — button + accepted-types line `CSV, TSV, text and Markdown. Spreadsheet workbooks: export as CSV first.`
  2. `Paste a link` — single input, helper `A public Google Sheet, Google Doc or web page. Private Google files cannot be read yet.`
  3. `Paste text` — textarea, helper `A list or a paragraph. Scout will pick out the companies.`
- Primary action `Read this source`, secondary `Cancel`.
- Readable check appears inline under the chosen doorway before reading: green `Can read: uk-dental-groups.csv` or amber `Cannot read: .xlsx workbook. Export as CSV.`

**Reading state**

- Same panel, replaced by three stage lines with a quiet spinner: `Reading source` → `Extracting companies` → `Checking against the board`. 150-250ms fades, reduced-motion respected.

**Staged result**

- Banner: `14 companies staged from uk-dental-groups.csv` with the loud pill `STAGED · NOT SAVED` (existing treatment kept).
- Counts line: `11 new · 2 already on the board · 1 cannot be read`.
- Rows, one per candidate:
  - Company name (editable inline), website below (editable, empty allowed).
  - State chip: `New` (green) / `Already on the board` (neutral) / `Cannot read` (amber).
  - Evidence line, muted, small: `"…acquired by Bright Dental Group in March…"` with `Observed` or `Inferred` tag on the website when guessed.
  - Row actions: keep toggle, remove.
- Fit is not shown here. A watchlist row is a decision, not a score.
- Honesty note at the foot, unchanged: Scout reports what it observed. No change stays quiet, missing evidence stays unknown, and nothing becomes urgent because Scout wants something to report.
- Actions: `Save 11 to watchlist` (primary), `Discard` (quiet). Save shows a brief confirmation, then rows land in the table.

Palette stays Trust Tai blues on white/soft-blue/cream; green only for new/success, amber only for human attention, red only for real failure.

## 7. Auth and migration implications

- No database migration.
- No new secrets for v1: public link fetch is unauthenticated; extraction uses the existing runtime provider selection (`OPENAI_API_KEY` or `LOVABLE_API_KEY`).
- The import route is under `/api/public/`, so it authenticates itself: bearer token + active membership, fail closed, same as `scout.discover`.
- Private Google files are explicitly out of scope until a Drive-scoped connection exists; the UI says so rather than failing mysteriously.
- Link fetch is size-capped and content-type checked, so a link cannot be used to pull an unbounded body into the model.

## 8. What happens to the CSV parser

Kept, demoted. `parseDelimitedRows` / `parseWatchlistImport` stay as the deterministic path used when the source is clearly delimited, and as the fallback when the model is unavailable (`ProviderNotConfiguredError` / `ProviderCallFailedError`) so a CSV import still works with no provider. Its tests stay. What goes away is the "Import list" wording and the paste-only doorway as the primary UX; paste becomes one of three doorways inside Smart Import.

## 9. Verification when built

Typecheck, lint on changed files, watchlist/import tests plus new grounding and refusal tests, full suite, build. New tests must prove: selecting a file or link writes nothing; ungrounded extractions are dropped; inferred websites are labelled; duplicates cannot be saved; only approved rows reach `addToWatchlist`; discard leaves no trace; provider-down falls back to the delimited parser for CSV and refuses honestly otherwise.

P4-01 stays below Production Verified until Tai exercises manual add and a real smart import in production.
