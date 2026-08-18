/**
 * Intelligence Engine, bounded semantic reasoning (server only).
 *
 * The model gets one job: connect observations the suite already made, and say
 * what they might mean together. It is given a packet of true statements and
 * nothing else, no transcripts, no free text, no web. Anything it returns
 * that is not traceable to that packet is dropped by verification before a
 * person ever sees it.
 *
 * Fail closed: a valid Trust Tai token and an active membership in this
 * organization are checked against the real backend before any model call.
 */

import {
  callRoadmapProvider,
  extractJsonObject,
  requireRoadmapAccess,
} from "@/lib/roadmap-research.server";
import type { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";
import type { EvidencePacket } from "@/data/intelligence/engine/hypothesise";
import type { RawHypothesis } from "@/data/intelligence/engine/verify";

/** Membership is verified server-side; a token alone is never enough. */
export async function requireEngineAccess(
  token: string,
  organizationId: string,
): Promise<boolean> {
  return requireRoadmapAccess(token, organizationId);
}

const INSTRUCTIONS = `You are the reasoning layer of Trust Tai OS, an operating system for a small
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

export async function reasonOverPacket(input: {
  token: string;
  organizationId: string;
  packet: EvidencePacket;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
}): Promise<{ hypotheses: RawHypothesis[]; provider: string; model: string }> {
  const allowed = await requireEngineAccess(input.token, input.organizationId);
  if (!allowed) {
    throw new Error("forbidden");
  }
  if (input.packet.observations.length === 0) {
    return { hypotheses: [], provider: "none", model: "none" };
  }

  const { raw, provider, model } = await callRoadmapProvider(
    INSTRUCTIONS,
    JSON.stringify(input.packet),
    { webSearch: false, ...(input.gateway ? { gateway: input.gateway } : {}) },
  );

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
