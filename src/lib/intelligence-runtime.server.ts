/**
 * The Trust Tai Intelligence Runtime — the single reasoning boundary (server only).
 *
 * Every room's model reasoning goes through here. The room assembles its
 * retrieval bundle under RLS, builds a ReasoningRequest, and calls
 * reasonWithRuntime. The boundary:
 *
 * 1. Fails closed: a valid token and active membership are verified against
 *    the real backend before any model call.
 * 2. Sends the model only the serialized retrieval bundle — no transcripts,
 *    no free text beyond what the room deliberately placed in evidence.
 * 3. Verifies everything that comes back against the bundle before a person
 *    sees it: facts must cite evidence, interpretations stay separated, next
 *    steps stay inside the capability registry and the approval boundary.
 * 4. Degrades honestly: when no provider answers, the room gets the
 *    deterministic read over the same bundle — never a blank surface, never
 *    an invented one.
 *
 * Rooms must not call providers directly. The fragmentation guard
 * (src/lib/intelligence-runtime-boundary.ts) enforces that in CI.
 */

import {
  callRoadmapProvider,
  extractJsonObject,
  requireRoadmapAccess,
} from "@/lib/roadmap-research.server";
import type { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";
import type { ReasoningRequest, RuntimeRead } from "@/domain/intelligence-runtime";
import { emptyRuntimeRead } from "@/domain/intelligence-runtime";
import {
  assembleDeterministicRead,
  verifyRuntimeRead,
  type RawRuntimeRead,
} from "@/data/intelligence/runtime/reason";
import { bundleForModel, type RetrievalBundle } from "@/data/intelligence/runtime/retrieval";

/** Membership is verified server-side; a token alone is never enough. */
export async function requireRuntimeAccess(
  token: string,
  organizationId: string,
): Promise<boolean> {
  return requireRoadmapAccess(token, organizationId);
}

const INSTRUCTIONS = `You are the reasoning layer of Trust Tai OS, an operating system for a small
services business. A room has asked you a question and handed you a packet. Every statement in the
packet is true. You may use only the packet.

Return a structured operator read — the things an experienced operator needs to know — as strict
JSON with exactly these fields:
{
  "facts": [{"statement": "...", "evidenceRefs": ["..."]}],
  "interpretations": [{"claim": "...", "because": "...", "restsOn": ["..."], "theme": "..."}],
  "unknowns": ["..."],
  "nextSteps": [{"title": "...", "owningRoom": "...", "operation": "...", "willDo": ["..."],
    "willNotDo": ["..."], "reversible": true}],
  "verification": [{"claim": "...", "evidenceKind": "test_result|changed_state|api_response|artifact|acceptance_criterion|downstream_receipt|human_acceptance", "description": "..."}],
  "confidence": "low|moderate|high",
  "operatorSummary": "one paragraph at most"
}

Laws you must obey:
1. Every fact must cite at least one evidence ref from the packet. A fact without a ref is dropped.
2. Interpretations are inferences, never facts. Each must rest on cited evidence refs.
3. Never introduce a company, person, project, number, amount, date or percentage that is not in
   the packet.
4. Never claim certainty or proven cause. These are readings, not verdicts.
5. Statements in "decided" were decided by a person. Never contradict one.
6. Rooms in "withheld" could not be read. Never guess what they contain; name the gap in unknowns.
7. Next steps may only use operations listed in the packet's capabilities.executable. External
   surfaces always require a person to carry them.
8. If the packet supports nothing worth saying, return empty lists. Silence is a valid answer.
9. Never comment on an individual's performance, reliability or effort.
10. Reason step by step internally, but return only the structured read — never your working.`;

export interface RuntimeReasonResult {
  read: RuntimeRead;
  /** Claims the gate refused, and why. */
  rejected: { claim: string; because: string }[];
  provider: string;
  model: string;
}

/**
 * The one way rooms reason with a model. Thin evidence is named honestly and
 * a provider failure degrades to the deterministic read over the same bundle.
 */
export async function reasonWithRuntime(input: {
  token: string;
  request: ReasoningRequest;
  bundle: RetrievalBundle;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
}): Promise<RuntimeReasonResult> {
  const allowed = await requireRuntimeAccess(input.token, input.request.organizationId);
  if (!allowed) {
    throw new Error("forbidden");
  }

  if (input.bundle.evidence.length === 0) {
    return {
      read: emptyRuntimeRead({
        room: input.request.room,
        objective: input.request.objective,
        unknowns: ["No evidence was supplied for this question."],
        withheld: input.bundle.withheld,
        now: input.request.now,
      }),
      rejected: [],
      provider: "none",
      model: "none",
    };
  }

  const packet = {
    objective: input.request.objective,
    output: input.request.output,
    verificationExpectation: input.request.verification,
    approval: input.request.approval,
    allowedOperations: input.request.allowedOperations,
    ...bundleForModel(input.bundle),
  };

  try {
    const { raw, provider, model } = await callRoadmapProvider(
      INSTRUCTIONS,
      JSON.stringify(packet),
      { webSearch: false, ...(input.gateway ? { gateway: input.gateway } : {}) },
    );
    const parsed = extractJsonObject(raw) as RawRuntimeRead;
    const verified = verifyRuntimeRead({
      raw: parsed,
      request: input.request,
      bundle: input.bundle,
    });
    return { read: verified.read, rejected: verified.rejected, provider, model };
  } catch {
    /* No provider, a refusal, a malformed reply: the room keeps its
       deterministic read over the same bundle rather than losing the surface. */
    return {
      read: assembleDeterministicRead(input.request, input.bundle),
      rejected: [],
      provider: "none",
      model: "none",
    };
  }
}
