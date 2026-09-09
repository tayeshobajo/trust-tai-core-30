# Intelligence Layer quality audit — Scout first

Scout is currently an **evidence pipeline with a very good rulebook**, not a reasoning system. Two model calls exist (discovery, smart import); every judgment a person actually sees — fit, who to approach, next move, movement, contradictions, staleness — is fixed weights, regex and if/else. That is not automatically wrong: much of it is correct governance. But four things are genuinely broken, and one architectural fact explains most of the intelligence gap.

## The architectural finding

`src/data/intelligence/runtime/retrieval.ts` already composes exactly what Tai is asking for: room evidence + decided statements + canon patterns + prior cases + **human corrections** + capabilities, bundled for the model with provenance (`composeRetrieval`, `bundleForModel`). **No Scout code calls it.** Scout's two model calls go straight to `runtimeModelCaller` with a hand-built prompt string (`src/lib/scout-discover.server.ts:143`, `src/lib/scout-import.server.ts:120`). So Scout reasons with no canon, no prior cases, and no memory of human corrections. The learning loop exists and is wired to nothing in Scout.

Secondary: the heaviest reasoning of all — reading a company website — happens in the external `scout-research` Edge Function (`src/data/supabase/scout-research.ts:53`), outside the runtime boundary and outside the fragmentation guard, which only scans `src/`.

## Findings by dimension

| # | Dimension | Verdict | Class |
|---|---|---|---|
| 1 | Canonical truth before research | Partly fixed last turn (contacts, org contacts, domain, intake). Still blind to `profiles`, org members, `clients`, projects, Comms relationships | Critical correctness |
| 2 | Reasoning vs heuristics | Static weights everywhere: `scout-intel.ts:165` (30/20/20/15/15), `person-priority.ts:19` (founder 40…), `relationship-development.ts:396`. Governance-safe, but no interpretation | High-value gap |
| 3 | Evidence-grounded | Strong. Observed/Inferred/Stated/Decided lanes, source URLs, "because" lines, unknown ≠ zero | Acceptable |
| 4 | Cross-source synthesis | Siloed. Website evidence only. No CRM history, messages, notes, projects, roadmap in any Scout read | High-value gap |
| 5 | Temporal | Arithmetic only: `RESEARCH_STALE_DAYS = 30`, `RECENT_DAYS = 180`. Movement diffs observed rows field-by-field (`scout/movement.ts`) — honest, but no sense of *significance* | Acceptable rule + gap |
| 6 | Contradiction | Three hand-written regex rules (`research-brief.ts:365-395`) covering visibility, capture, audience. Nothing for founder, size, positioning, contact route. Silent picking elsewhere | Critical correctness |
| 7 | Intent / why we watch | Absent. No watch-reason is captured or reasoned from. Fit is generic ICP score only | High-value gap |
| 8 | Person quality | Regex role classifier (`person-resolution.ts:74`); no fabrication (good); no cross-room reuse (see 1) | Critical correctness |
| 9 | Handoff coherence | Four independent rankers: `person-priority.ts`, `comms-handoff.ts:118`, `scout-gaps.ts`, `recommended-move.ts`. They can disagree | Critical correctness |
| 10 | Memory / learning | Pulse feedback does feed forward (`pulse/projection.ts:138`). Scout decisions are append-only audit; nothing reads them back | High-value gap |
| 11 | Model boundary | Clean and CI-enforced (`intelligence-runtime-boundary.ts`, zero exceptions). But `scout-research` Edge Function is unguarded | UX/architecture gap |
| 12 | Graceful failure | Honest almost everywhere. One exception: smart import silently falls back to `deterministicExtraction()` on provider failure (`scout-import.server.ts:143`) and returns candidates as if AI read them | Critical correctness |

## A. Top 5 to fix before calling Scout intelligent

1. **Scout reasons through the shared retrieval bundle.** Route discovery, import and the company read through `composeRetrieval()` so canon, prior cases and human corrections reach the prompt. Without this, nothing else compounds.
2. **Canonical identity resolution completed.** Extend `planPersonResolution()` inputs to `profiles`, `organization_memberships`, `clients`/client contacts, and Comms relationships for the same domain. Deterministic, provenance-preserving, canonical wins over inferred.
3. **One handoff read.** A single `scoutRead(prospect)` result that People, Approach First, Ready and the Comms brief all project. Delete the parallel rankers.
4. **Contradictions become general, not three regexes.** A typed conflict record for founder, size, positioning and contact route, with explicit precedence (human-decided > canonical record > observed page > inferred) and the conflict always shown, never silently resolved.
5. **Smart import stops pretending.** A deterministic fallback must be labelled in the UI as "AI could not read this — here is a plain parse", or refused.

## B. Mockup vs bounded fix

**Bounded correctness fixes (no new UX, can be implemented directly):** 2, 5, plus wiring 1 behind the existing surfaces.

**Needs a mockup first (Mockup Before UI Build):** 3 (one coherent read changes what People/Approach/Ready show), 4 (conflicts need a calm way to appear), and any watch-reason capture (dimension 7).

## C. Proposed Intelligence Layer laws

1. **Resolve before researching.** Canonical Trust Tai truth is searched exhaustively before any surface says "unknown".
2. **One read per company.** Every surface projects the same reasoning result. Two rankers that can disagree is a bug.
3. **Reason through the bundle.** Any room model call composes retrieval — canon, prior cases, corrections — or it is not runtime reasoning.
4. **Corrections outrank inference, permanently.** A human correction changes future reads or the loop does not exist.
5. **A conflict is shown, never resolved silently.** Precedence orders sources; it never hides the disagreement.
6. **Deterministic is honest about being deterministic.** A rule-based fallback is never presented as an AI read.
7. **Governance stays code.** Thresholds, gates, ordering and permission remain deterministic and testable. Only interpretation goes to the model.

## D. Test cases

- Founder already known elsewhere (profile / org member / client contact) on the same domain resolves in Scout with no manual entry — the Trust Tai Acceptance Test case, written generically.
- Two sources disagree on founder → both surfaced with precedence stated, neither dropped.
- Stale observed fact vs newer contradicting one → newer wins, older retained as history, conflict noted.
- No email route known → says not known; never constructs an address.
- Human correction replayed → the same input after correction produces the corrected read.
- Same-company dedupe across domain variants (`www`, trailing slash, casing) → one canonical company.
- Provider failure during import → labelled deterministic, never presented as an AI read.
- People, Approach First and Comms brief all return the same person id for one prospect.

## E. Schema

Nothing needed for fixes 1, 2, 3 and 5 — existing `contacts`, provenance, `metadata`, activities and the canon/case tables carry it.

Fix 4 (contradictions) and a durable Scout feedback ledger would each want a table. Both are later steps; specify them when we reach them.

## F. Execution order (no percentage changes)

1. Commit the pending person-resolution fix (currently uncommitted).
2. Fix 5 — import honesty. Smallest, pure correctness.
3. Fix 2 — complete canonical resolution sources.
4. Fix 1 — Scout reasons through `composeRetrieval()`.
5. Mockup, then build fix 3 — one coherent read.
6. Mockup, then build fix 4 — general contradictions.
7. Then revisit watch-reason (dimension 7) and the Scout feedback loop (10).

Percentages stay untouched throughout.
