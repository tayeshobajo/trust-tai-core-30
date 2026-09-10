# Steward. Semantic Meeting Intelligence

Steward no longer surfaces raw speech. Every card a person reads is a normalized
operational sentence produced by a server-only interpreter.

## Pipeline

1. **Normalize**. Fathom transcript becomes a `NormalizedConversation` (`src/lib/steward-fathom.server.ts`).
2. **Scout candidates**, `src/data/steward/candidates.ts` selects `CandidatePassage`
   windows (focus turn + 3 before / 2 after) with stable ids, so re-running is idempotent.
3. **Interpret**, `src/lib/steward-interpret.server.ts` batches 6 passages per model call
   through the Lovable AI gateway and returns strict JSON `InterpretedSignal`s.
4. **Filter**, `isCleanMeaning` (`src/data/steward/interpretation.ts`) rejects ASR wreckage,
   filler, and copied speech.
5. **Review**, `src/components/tt/steward/semantic-review.tsx` leads with the meaning;
   transcript and rationale sit behind disclosure.

Entry point: `POST /api/public/steward/interpret` (auth-gated, organization scoped).

## Laws the interpreter must obey

- People are people, never task sources: no grading, scoring, or shaming.
- Recollection, capability, coaching, opinion and hypotheticals are `context_only`.
- Unresolvable referents return `insufficient_evidence` with what is unclear.
- No invented owner, date, project, or beneficiary. `due_text` carries spoken words only.
- `truth_tier` is `observed` or `inferred`, never `decided`; humans decide.
- `normalized_meaning` is one plain-English actionable sentence.

## Person-centered reasoning

Canonical memory passed to the interpreter includes open commitments, known people
(name, title/pod, responsibilities from `steward_role_memory`), and project labels.
The interpreter uses roles to judge who realistically owns an action rather than
defaulting to whoever spoke. A role-implied owner stays `inferred` with moderate or
lower owner confidence. When memory cannot be read, the payload says so and the
interpretation is made from the meeting alone.

## Today cleanup

`src/data/steward/today.ts` flags any stored commitment whose text still reads like raw
speech as **Needs restating**, and the Today surface offers re-interpretation instead of
showing transcript noise.

## Acceptance (read-only)

Target: Fathom meeting `779145597` (Bioptrics Plan update), 633 segments, 32 candidates.
Run `bun run scripts/steward-semantic-acceptance.ts`. No writes are performed.
Roughly two thirds of candidates return reviewable meanings (commitments, decisions,
dependencies, open questions); the rest are withheld as context or insufficient evidence.
