# Studio Slice B — the brief builder

"Build brief" on an opportunity row stops being decoration. It opens a real brief above the composer: a chosen title with the reason behind it, an opening, and the story's sections — written on the same warm editorial surface Slice A uses, inside Studio, not a new room.

One thing already true and unchanged: **"What Studio noticed" is already reading live Website search and page data** over a rolling 30-day window. Rows refresh as new search and page data arrives. Nothing to rewire there.

## What you'll be able to do

1. Press **Build brief** on any opportunity row that has a real move behind it.
2. Studio reasons over the observed evidence and returns a draft brief: two or three title candidates (each saying what's familiar about it, what's fresh, and what the reader was after), a first paragraph plus why it earns the second, and the End → Beginning → Middle → Landing spine.
3. You choose or rewrite the title, edit the opening, and edit any section line. Your wording wins over Studio's.
4. **Keep brief** saves it. **Discard** throws it away. Nothing is written until you press one.
5. A kept brief stays on the row and reopens later. The opportunity reads as "brief built".

Deliberately not in this pass: the brief does not write a post yet, no images are planned or generated, publishing is untouched.

## Honesty rules kept

- If search reported nothing, the quiet state stays as it is and no brief can be built from it.
- Observed evidence stays visually separate from Studio's read.
- Studio's read of the numbers stays deterministic and labelled as Studio's read. Only the brief itself is model-reasoned, and it says so.
- If the model is unavailable, Studio says so plainly instead of returning a hollow brief.
- Nothing writes, sends or publishes on its own.

## Database

New tables in the shared Supabase project, delivered as `docs/studio-briefs-schema.sql` for you to apply — same pattern as the Scout sweep schema. I'll write the file; the feature only goes live once you've applied it, and until then Studio says the brief store isn't provisioned rather than failing silently.

- `studio_content_briefs` — one row per kept brief: core idea, angle, title candidates and chosen title, opening, spine, seo evidence, source opportunity, state, who kept it and when.
- `studio_opportunity_decisions` — the durable open / brief_built / dismissed / acted state per opportunity id, so "Not now" and "brief built" survive a reload.
- `studio_opportunity_corrections` — reserved now, used in the next pass, so you only apply SQL once.

All three: organization-scoped, RLS on, membership-gated read/write, explicit grants to `authenticated` and `service_role`.

## Technical shape

- `docs/studio-briefs-schema.sql` — schema above.
- `src/lib/content-brief.server.ts` — brief composition through the existing intelligence runtime model caller, with the shared retrieval bundle; returns a `ContentBrief` matching the existing `src/domain/content-brief.ts` contract. No new contract invented.
- `src/routes/api/public/content.brief.ts` — bearer-authenticated route calling that composer; honest failure payload when the provider does not answer.
- `src/data/supabase/studio-brief-service.ts` — read/write briefs and opportunity decisions; reports `provisioned: false` when the tables are absent.
- `src/data/content/brief-view.ts` (+ tests) — pure projection and edit-merge: human edits outrank model text, required fields validated, spine order fixed.
- `src/components/tt/studio/brief.tsx` — the brief surface, reusing Slice A's `bg-studio-paper` treatment and the accepted mockup's typography. No new design system.
- `src/routes/modules.studio.index.tsx` — wire `Build brief` on actionable rows, render the brief above the composer when open, and read durable decisions instead of visit-only `setAside`. Composer, sources, batches, Approvals and publish paths untouched.
- Tests: brief projection, edit precedence, provider-unavailable honesty, decision state filtering. Then typecheck, changed-file lint, full suite, build.

## After this pass

1. **Corrections panel** — edit a row's observed evidence and Studio's read; corrections outrank inference and are fed into the next Studio run through the retrieval bundle.
2. **Brief → post** — approving a brief pre-fills the existing composer command (keyword, angle, instructions) and runs today's batch pipeline, so Approvals and publish behave exactly as they do now.
