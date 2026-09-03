# Trust Tai Intelligence Runtime

The shared reasoning layer every suite room uses. The law it enforces:
**no business app may become its own isolated AI brain.**

This document is the implementation companion to canon §11
(`docs/architecture-canon.md`). It exists so Scout, Comms, Roadmap, Projects,
Ops, Studio, Steward and Conductor reach the same depth of reasoning, the
proactive, problem-solving depth the OpenClaw diagnostic demonstrated, without any room inventing its own AI stack.

## The lesson that shaped it

The OpenClaw diagnostic was right and the completion failed: the reasoning
found the real problem, but "the action ran" was accepted as proof, and a
failed attempt produced a dead end instead of the next bounded diagnostic
step. The runtime makes both impossible:

- completion is a claim that must carry proof (`verification.ts`)
- a failed attempt always produces a bounded next step or a named escalation
  (`protocol.ts`)

## The five pieces

### 1. One reasoning boundary, `src/lib/intelligence-runtime.server.ts`

`reasonWithRuntime({ token, request, bundle })` is the only way a room reasons
with a model. It fails closed (token + active membership verified server-side),
sends the model only the serialized retrieval bundle, verifies everything that
comes back, and degrades to the deterministic read, never a blank surface, when no provider answers.

Low-level machinery it alone may use: the transport
(`roadmap-research.server.ts`), provider selection (`scout-provider.server.ts`),
run-id plumbing (`ai-gateway.server.ts`).

### 2. Retrieval composition, `src/data/intelligence/runtime/retrieval.ts`

`composeRetrieval(...)` normalizes what the caller assembled under RLS into one
bundle: evidence (provenance-tagged, cross-room items read-only), decided
statements (they outrank inference), withheld rooms (never guessed at), canon
pattern matches, prior experience with human corrections first, the capability
view, and context packets. `bundleForModel` serializes exactly what the model
may see.

### 3. The read contract, `src/domain/intelligence-runtime.ts`

`ReasoningRequest` in, `RuntimeRead` out. The read separates:

- **facts**, each cites at least one bundle evidence ref
- **interpretations**, labelled inference, resting on cited refs, never
  contradicting a person's decision
- **knowledge**, the canon patterns, cases and corrections that informed it
- **unknowns**, named gaps; silence is a valid answer
- **nextSteps**, bounded, inside the capability registry and approval boundary
- **confidence**, capped by evidence count (`runtimeConfidence`)
- **verification**, what must be proven for any executed step to count as done
- **provenance**, evidence refs, knowledge refs, withheld rooms

`verifyRuntimeRead` (`reason.ts`) is the gate: untraceable facts, invented
numbers, decision contradictions and out-of-registry operations are dropped
with reasons, never silently reshaped. `assembleDeterministicRead` is the
no-model fallback over the same bundle.

### 4. The protocol, `src/data/intelligence/runtime/protocol.ts`

inspect → retrieve → hypothesise → test safely → observe evidence → adjust →
act within boundary → verify → escalate.

`nextProtocolStep(attempts, context)`: after a failure it names the next
untried inspection (canon `evidenceToInspect`), then missing retrieval, then
an adjustment pass; after `MAX_DIAGNOSTIC_ATTEMPTS` (3) it escalates naming
what was tried and what is missing. A blocked human boundary escalates
immediately. Success moves to verification, never straight to "done".

### 5. The completion gate, `src/data/intelligence/runtime/verification.ts`

`verifyCompletion(claim, expectation)`: "the action ran" is never proof.
Accepted evidence kinds: test result, changed state, API response, artifact,
acceptance criterion, downstream receipt, human acceptance. Claims by runtime,
adapter or agent additionally require objective proof, they cannot grade
their own homework. `expectedEvidenceFor(work)` composes the expectation from
the shape of the work so rooms ask for proof up front.

## Capability awareness, `src/domain/intelligence-capabilities.ts`

`roomCapabilities(room)` composes the adapter registry, the app registry and
action authority into one answer: what the room can execute, what is declared
but unroutable (with the reason), whether it is read-only, which surfaces are
external (a person carries those), and what always requires approval.
`verifyRuntimeRead` consults it: a next step naming an unroutable operation is
rejected; an external one is marked `external` and approval-forced.

## Readiness, `src/data/intelligence/runtime/manifest.ts`

Every registered room declares eight aspects, evidence grounding, retrieval,
domain patterns, capability awareness, safe diagnostic loop, verification,
approval boundary, outcome learning, with code citations and honest states
(`available` / `partial` / `absent` / `not_required`). The manifest is the
migration map: `partial` means the machinery exists but the room has not
adopted the runtime for it yet.

## Acceptance tests, `src/data/intelligence/runtime/acceptance.test.ts`

Suite-wide invariants: every registry room has a manifest; no business room is
absent on evidence grounding, capability awareness, verification or the
approval boundary; confidence never outruns evidence; no room accepts a bare
"action ran" completion; a failed attempt always yields a bounded step or a
named escalation; an empty read is honestly empty.

## The fragmentation guard, `src/lib/intelligence-runtime-boundary.ts` (+ test)

CI-enforced: outside the canonical modules, no file imports provider
transport/selection, references provider or gateway URLs, or pulls run-id
plumbing outside transport code and API handlers. Pre-runtime call sites
(`scout-discover`, `comms-draft`, `steward-interpret`, `roadmap-studio`,
`intelligence-reason`, and their route shells) are documented exceptions, each
with a named migration. A new bypass fails the build; a stale exception fails
the build too.

## Projects: the first proof, `src/domain/project-operator-read.ts`, `src/data/projects/operator-read.ts`

Before a milestone is executable, Projects asks: *what does an experienced
operator need to know?* `operatorReadRequestFor` builds the ReasoningRequest
from the milestone's context packet (decisions decided-tier, blockers and work
derived-tier, provenance on every ref); `foldOperatorRead` folds the verified
RuntimeRead into the operator contract: missing context, pattern knowledge,
risks, dependencies, proposed acceptance criteria, capability fit, the
verification plan, and, when the packet is too thin, the clarifying
questions to ask instead of acting.

## Adopting the runtime in a room

1. Assemble evidence under RLS in the room's service, as today.
2. `composeRetrieval({...})` with the room's evidence, decided statements,
   withheld rooms, engine observations (for canon matching) and ledger inputs.
3. Build a `ReasoningRequest`: objective, allowedOperations from
   `roomCapabilities(room)`, output kind, approval boundary, verification
   expectation.
4. Call `reasonWithRuntime` (server-side; token + membership fail closed).
5. Render the `RuntimeRead`: facts as facts, interpretations as readings,
   unknowns as honest gaps, next steps behind the approval boundary.
6. On execution, require `verifyCompletion` evidence before reporting done.
7. Record outcomes into the canon ledger so the next read is wiser.

## Deliberately not built

- No new endpoints or UI: this pass is the foundation, not a surface.
- No per-room model configuration: rooms choose output kind and evidence,
  not providers.
- No chain-of-thought exposure: reasoning stays inside the boundary; the read
  carries "because" lines that cite evidence.
