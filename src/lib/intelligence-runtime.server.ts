/**
 * The Trust Tai Intelligence Runtime — the single reasoning boundary (server only).
 *
 * Every room's model reasoning goes through here. The room assembles its
 * retrieval bundle under RLS, builds its question, and calls one of the two
 * entry points below:
 *
 * - `reasonWithRuntime` for a structured operator read over a retrieval
 *   bundle (facts, interpretations, unknowns, bounded next steps), verified
 *   against the bundle before a person sees it.
 * - `runtimeModelCaller` for a room-specific prompt (Steward's interpreter,
 *   Comms drafts, Scout discovery, Roadmap research, Studio composition):
 *   access is verified once, fail-closed, and the returned caller is the only
 *   way that room's prompt reaches a provider.
 *
 * The boundary:
 *
 * 1. Fails closed: a valid token and active membership are verified against
 *    the real backend before any model call.
 * 2. Sends the model only what the room deliberately assembled — never
 *    transcripts or free text beyond what the room placed in evidence.
 * 3. Verifies what comes back where a verifier exists, and degrades honestly:
 *    when no provider answers, the room gets the deterministic read over the
 *    same bundle — never a blank surface, never an invented one.
 *
 * Rooms must not call providers directly. The fragmentation guard
 * (src/lib/intelligence-runtime-boundary.ts) enforces that in CI.
 */

import {
  callRoadmapProvider,
  extractJsonObject,
  requireRoadmapAccess,
} from "@/lib/roadmap-research.server";
import { scoutProviderStatus } from "@/lib/scout-provider.server";
import type { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";
import type { EvidencePacket } from "@/data/intelligence/engine/hypothesise";
import type { RawHypothesis } from "@/data/intelligence/engine/verify";
import type { ReasoningRequest, RuntimeRead, RuntimeRoom } from "@/domain/intelligence-runtime";
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

/* ----------------------------------------- the room-facing model caller */

/**
 * What the call is for, recorded so the boundary stays auditable per room.
 * One purpose per room module; the fragmentation guard keeps it that way.
 */
export type RuntimePurpose =
  | "engine_hypotheses"
  | "meeting_interpretation"
  | "draft"
  | "discovery"
  | "research"
  | "studio_generation";

export interface RuntimeModelCall {
  instructions: string;
  input: string;
  webSearch?: boolean;
  /** Strict response format for callers that need one (e.g. Scout discovery). */
  responseFormat?: Record<string, unknown> | undefined;
  /** Mid-run progress: fires on each streamed text delta. */
  onDelta?: ((delta: string) => void) | undefined;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
  initialRunId?: string | undefined;
}

/**
 * The only way a room's prompt reaches a provider. Created by
 * `runtimeModelCaller` after access has been verified; carries no ambient
 * authority of its own beyond that verified call.
 */
export type RuntimeModelCaller = (
  call: RuntimeModelCall,
) => Promise<{ raw: string; provider: string; model: string }>;

/**
 * Verify access once, fail-closed, then hand the room a caller scoped to its
 * name and purpose. Batched room flows (Steward reads a meeting in windows)
 * verify once and call many times through the returned caller.
 */
export async function runtimeModelCaller(access: {
  token: string;
  organizationId: string;
  room: RuntimeRoom;
  purpose: RuntimePurpose;
}): Promise<RuntimeModelCaller> {
  const allowed = await requireRuntimeAccess(access.token, access.organizationId);
  if (!allowed) {
    throw new Error("forbidden");
  }
  return (call) =>
    callRoadmapProvider(call.instructions, call.input, {
      webSearch: call.webSearch ?? false,
      ...(call.responseFormat ? { responseFormat: call.responseFormat } : {}),
      ...(call.onDelta ? { onDelta: call.onDelta } : {}),
      ...(call.gateway ? { gateway: call.gateway } : {}),
      ...(call.initialRunId ? { initialRunId: call.initialRunId } : {}),
    });
}

/** Secret-free provider readiness, answered at the boundary for every room. */
export function runtimeProviderStatus(): ReturnType<typeof scoutProviderStatus> {
  return scoutProviderStatus();
}

/** JSON extraction, re-exported so rooms never import the transport. */
export { extractJsonObject };

/* -------------------------------------------------- engine hypothesising */

const ENGINE_INSTRUCTIONS = `You are the reasoning layer of Trust Tai OS, an operating system for a small
services business. You are given a packet of observations the system already made. They are
all true.

Your job is to notice what they mean TOGETHER. Connect observations across different rooms
(scout, comms, roadmap, projects, ops, steward) into readings a thoughtful business partner
would voice. Do not restate a single observation as a reading.

Laws you must obey:
1. Use only the packet. Never introduce a company, person, project, number, amount, date or
   percentage that is not in it.
2. Never claim certainty or proven cause. These are readings, not verdicts.
3. Statements in "decided" were decided by a person. Never contradict one.
4. Pattern keys in "suppressed" were rejected by a person. Do not raise those shapes again.
5. Rooms in "withheld" could not be read. Never guess what they contain.
6. If the packet supports nothing worth saying, return an empty list. Silence is a valid answer.
7. Never comment on an individual's performance, reliability or effort.

Return strict JSON only:
{"hypotheses":[{"theme":"capacity|delivery|pipeline|follow_through|friction|client_risk|opportunity",
"claim":"one sentence, plain English","because":"one sentence citing what it rests on",
"observationRefs":["obs:..."],"contradicts":["obs:..."]}]}

At most 4 hypotheses. Each must cite at least two observationRefs, ideally from different rooms.`;

/**
 * The engine's bounded semantic pass: connect observations the suite already
 * made. Verified on the way back in the client-safe engine module; anything
 * not traceable to the packet is dropped before a person sees it.
 */
export async function reasonOverPacket(input: {
  token: string;
  organizationId: string;
  packet: EvidencePacket;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
}): Promise<{ hypotheses: RawHypothesis[]; provider: string; model: string }> {
  const callModel = await runtimeModelCaller({
    token: input.token,
    organizationId: input.organizationId,
    room: "home",
    purpose: "engine_hypotheses",
  });
  if (input.packet.observations.length === 0) {
    return { hypotheses: [], provider: "none", model: "none" };
  }

  const { raw, provider, model } = await callModel({
    instructions: ENGINE_INSTRUCTIONS,
    input: JSON.stringify(input.packet),
    webSearch: false,
    ...(input.gateway ? { gateway: input.gateway } : {}),
  });

  const parsed = extractJsonObject(raw);
  const list = Array.isArray(parsed["hypotheses"]) ? (parsed["hypotheses"] as unknown[]) : [];
  return {
    hypotheses: list.filter(
      (entry): entry is RawHypothesis => Boolean(entry) && typeof entry === "object",
    ),
    provider,
    model,
  };
}

/* ------------------------------------------------- structured room reads */

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
  const callModel = await runtimeModelCaller({
    token: input.token,
    organizationId: input.request.organizationId,
    room: input.request.room,
    purpose: "engine_hypotheses",
  });

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
    const { raw, provider, model } = await callModel({
      instructions: INSTRUCTIONS,
      input: JSON.stringify(packet),
      webSearch: false,
      ...(input.gateway ? { gateway: input.gateway } : {}),
    });
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
