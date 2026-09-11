# Studio Slice B — opportunity brief idempotency

## Outcome
Protect the existing Slice B loop so one organization can keep at most one brief for each Website opportunity, including retries and concurrent saves. No UI, state, decision, generation, approval, or publishing behavior changes.

## Changes
1. Update `docs/studio-briefs-schema.sql` with a database uniqueness constraint on `(organization_id, source_opportunity_id)`. Keep `source_opportunity_id` nullable so future non-opportunity briefs remain possible. Write the DDL so it also adds the constraint when the tables already exist.
2. Update `src/data/supabase/studio-brief-service.ts`:
   - existing briefs with an `id`: update by `id` and `organization_id` exactly as today;
   - new briefs with a source opportunity: upsert on `organization_id,source_opportunity_id`;
   - new briefs without a source opportunity: retain ordinary insert behavior.
3. Add a focused pure-path test covering all three persistence choices, without adding a new service layer.

## Verification
Run the focused test, TypeScript check, lint only for changed TypeScript files, the full test suite, and the production build. Review the final diff and current build diagnostics. The SQL will only be authored for review; it will not be applied.
