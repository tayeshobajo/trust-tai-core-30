# Hosted build diagnosis (no changes made)

## Findings
- Commit: `d45d760a` "Integrate reviewed Studio tabs with the current CMD release" (local tree clean).
- The app itself builds: the Vite dev server compiles and serves; only deprecation warnings (`inputValidator()`).
- The failing step is NOT the web build. It is the platform's Deno type check of the backend functions in `supabase/functions/`. Exact error from the build log:

```text
error: Could not find a matching package for 'npm:@supabase/realtime-js@2.119.0'
in the node_modules directory ... run `deno install` or set "nodeModulesDir": "auto"
at https://jsr.io/@supabase/supabase-js/2.119.0/src/index.ts:27:15
(deno::graph_container::MainModuleGraphContainer::check_specifiers)
```

- Source: `supabase/functions/paperclip-reconcile/index.ts:12` imports `jsr:@supabase/supabase-js@2`. The floating `@2` now resolves to 2.119.0, whose JSR package pulls `npm:@supabase/realtime-js`, which Deno can't resolve without a node_modules dir. Every other function uses `https://esm.sh/@supabase/supabase-js@2` and is unaffected.
- That file hasn't changed recently (last: `ef60587c`), so the failure was triggered by an upstream release, not by d45d760. This explains why prior commits also show "Build unsuccessful".
- Verdict: the history label is not stale — the hosted check really fails, on every commit since the upstream release. "Project ready / error null" refers to the edit sync, not this check. The auth-check screen in the preview is the app's normal sign-in gate, not a build failure.
- I can't open the platform's hosted build logs directly; the error above is the build log carried over into this sandbox, which matches what you're seeing.

## Decision
You chose to stop at the diagnosis. Lovable will make no changes. Approving this plan only records the diagnosis; it doesn't edit, rebuild or publish anything.

## Smallest fix (for you to apply outside Lovable)
Change the import in `supabase/functions/paperclip-reconcile/index.ts` to match the other functions:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
```
(Or pin `jsr:@supabase/supabase-js@2.49.x`.) Nothing is deployed and the database isn't touched; the function's code is unchanged in practice. Then trigger "Update preview" and confirm the build log reads "build OK" before publishing.
