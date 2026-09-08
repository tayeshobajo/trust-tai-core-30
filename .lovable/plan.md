# P4-02 — Bounded scheduled sweep, refresh in place

Inspection, acceptance definition and mockup specification only. No code changes this turn.
P4-01 stays open; Tai's passed manual-add QA is not repeated. No percentage changes.

## 1. What already exists, and who owns it

| Capability | Where it lives | Owner |
| --- | --- | --- |
| Controlled research plan (what to read, what to preserve, stale at 30 days) | `src/data/scout/research-run.ts` (`planResearchRun`, `mergeObservedRows`, `researchLifecycle`) | pure logic, no writes |
| Run one company's pass, merge evidence, write provenance + `prospect.researched` | `src/data/supabase/scout-service.ts` (`research`, `runResearch`) | canonical Scout service |
| Public-website reading | `scout-research` Edge Function via `src/data/supabase/scout-research.ts` | existing integration |
| Research permission (fail-closed) | `src/data/scout/research-consent.ts` | existing law |
| Watchlist membership marker | `prospects.metadata.scout_watchlist`, `src/data/supabase/scout-watchlist.ts` | canonical prospects store |
| Evidence history / pulse (Movement source) | `src/data/prospect-modules.ts` (`readResearchHistory`, `computePulse`), `prospect_evaluations` | existing |
| Scheduled job precedent | `src/routes/api/public/comms.gmail.scheduled-sync.ts` + pg_cron recipe in `docs/comms-integrations-schema.sql` (`COMMS_SYNC_CRON_SECRET`, constant-time compare) | existing pattern |
| Streaming authenticated Scout route precedent | `src/routes/api/public/scout.discover.ts`, `scout.import.ts` (bearer + active membership) | existing pattern |

Conclusion: every part of a sweep already exists except the *loop over watched companies on a schedule*. No new agent, room, store, status, dashboard or scheduler architecture is needed. The sweep is a bounded iterator over `runResearch`, owned by the existing Scout service.

## 2. What "bounded" means here (smallest canon-consistent contract)

Bounded is a combination, all reusing values already in the system:

- **Scope bound**: only companies carrying `metadata.scout_watchlist` (Sentinel is curated only). Nothing discovered, nothing global.
- **Per-run cap**: at most **10 companies per sweep run**, selected oldest-checked-first.
- **Staleness bound**: a company is only re-read when `planResearchRun` says it is missing or older than the existing `RESEARCH_STALE_DAYS = 30`. Nothing fresh is re-read.
- **Frequency**: one scheduled run per day (pg_cron), plus a manual run.
- **Concurrency**: sequential, one company at a time, with a single-flight lease so a second run exits instead of doubling up.
- **Permission bound**: withheld or unsettled research consent skips the company and says so.
- **Watchlist size**: soft cap of **50 watched companies**; beyond that the surface states plainly that the sweep covers the 50 oldest-checked and asks a person to trim the list. No silent truncation.

## 3. Immediate refresh in place, without a second workflow

"Refresh in place" is the same code path as the schedule, invoked by a person:

- One control on the Watchlist header: **Check watched companies now**. It runs exactly the bounded sweep described above, in the foreground, reporting progress inline.
- One control per row (already conceptually present through the company detail research action): **Check now** for a single company, calling the existing `runResearch`.
- Both reuse `planResearchRun` → `runResearch` → `mergeObservedRows`. No discovery, no new candidates, no scoring pass, no second workflow.

## 4. What the sweep settings expose

Kept to three plain lines inside Scout Settings (existing surface), no new dashboard:

1. **Automatic check** — On / Off (default On).
2. **How often** — Daily / Weekly.
3. A read-only sentence: "Scout re-reads up to 10 watched companies a day, oldest first, and only if their evidence is missing or older than 30 days."

Plus a last-run line: "Last checked 6 hours ago · 7 read · 3 already current · 0 could not be read." Counts only, no percentages, no health score.

## 5. Quiet state — exact behavior

When a sweep completes and no observed evidence changed:

- Movement stays **empty**; nothing is added there.
- No activity event of any new kind is written for "nothing changed". Only the existing per-company `prospect.researched` event is written for companies actually read.
- The Watchlist rows update their **Checked** timestamp only.
- The single quiet line on Watchlist: **"Checked today. Nothing changed."** Neutral muted styling, no colored badge, no count-up animation, no notification, no toast for the scheduled run.
- If nothing was even due: "Everything on the watchlist was checked in the last 30 days."

## 6. Preparing truth without manufacturing Movement

P4-02 writes evidence; P4-03 interprets change. Boundary:

- The sweep only calls the existing `research` path, which merges observations (`mergeObservedRows`) and appends to research history / `prospect_evaluations`. That is the *record* Movement will later read.
- The sweep never sets any movement flag, never computes a delta label, never reorders the board, never bumps priority, never marks anything "new" or "hot".
- A company appears in Movement only through the existing `computePulse` over recorded history, unchanged in this slice.
- Absence stays absence: an unreadable site records a failure reason, not a downgrade.
- Fit is untouched by the sweep beyond the existing evaluator behavior on a real pass; no ranking theatre.

## 7. Infrastructure, migrations, secrets

- **Auth (scheduled)**: reuse the Comms pattern — a new project secret `SCOUT_SWEEP_CRON_SECRET`, checked with a constant-time compare in `src/routes/api/public/scout.sweep.ts`. No secret configured means the endpoint returns 503.
- **Auth (manual)**: bearer token + active membership, exactly as `scout.discover.ts`.
- **Scheduler**: pg_cron on the existing external Supabase project, calling `https://cmd.trusttai.com/api/public/scout/sweep`. Recipe documented as commented SQL, like `docs/comms-integrations-schema.sql`; applied by a human.
- **Migration**: none required for evidence. One small state need — the single-flight lease and last-run summary. Smallest option: store both on the organization's existing `icp_profiles`/organization-scoped metadata rather than a new table. A dedicated `scout_sweep_state` table is only justified if no organization-scoped JSON column is available; decide at implementation, prefer no new table.
- **Deployment**: cron must point at the published domain; preview runs manual only.

## 8. Mockup specification (minimal, no redesign)

Stays on the current Watchlist screen. Two additions only.

**A. A quiet status strip**, directly under the existing Watchlist heading and above the honesty note:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  Automatic check is on · daily          Checked today. Nothing changed.  │
│  12 watched · 7 read · 3 already current · 0 could not be read           │
│                                        [ Check watched companies now ]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- Card in existing muted surface, one border, no accent fill when quiet.
- Left: settings echo, muted. Middle: the quiet sentence. Right: a secondary button in Trust Tai blue.
- While running, the button becomes a disabled spinner label cycling the existing motion language (150-250ms transitions, reduced motion respected): "Reading Northfield Dental (3 of 10)".
- On completion, the counts line updates in place with a single fade; no toast for the scheduled run, one calm toast for a manual run.
- Amber only when something could not be read ("2 could not be read"), green only on a company genuinely newly read, red never in this surface.

**B. Per-row checked line**, in the existing row meta slot: `Checked 2 days ago` / `Not researched yet` / `Research not permitted`, plus a quiet row action **Check now** revealed on hover/focus.

Nothing else on the Watchlist changes: manual Add company and Add from source stay exactly as they are, no fit score enters this surface, no new tab, no monitoring dashboard.

## 9. Tests and production QA for Production Verified

**Unit / pure (new `src/data/scout/sweep.test.ts`)**
- selects only watched companies
- caps at 10 per run, oldest-checked first
- skips fresh companies (<30 days) and reports them as "already current"
- skips withheld/unsettled research consent with a stated reason
- a second concurrent run exits instead of running in parallel
- a company that fails to read does not stop the run and keeps its prior evidence
- a run where nothing changed produces no movement flag and no extra event

**Server (`src/routes/api/public/scout.sweep.test.ts`)**
- missing secret → 503; wrong key → 401; correct key → runs
- manual path requires bearer + active membership
- the route never creates companies, never sends anything

**Integration**
- existing Scout law tests unchanged and passing (P4-05)
- merge preserves untouched areas after a sweep

**Production QA by Tai**
1. Watchlist shows the status strip with real counts and current settings.
2. Press **Check watched companies now**; progress is visible; when done counts update and Watchlist rows show fresh "Checked" times.
3. Run it again immediately; it reports everything already current and reads nothing.
4. Confirm Movement is still empty when nothing changed, and the board did not reorder.
5. Confirm a company with no research permission is skipped with a plain reason.
6. After the cron is installed, confirm the next day the last-run line advanced without anyone pressing anything, and no notification or new company appeared.

Only after step 6 does P4-02 reach Production Verified. Percentages move at that point, not before.
