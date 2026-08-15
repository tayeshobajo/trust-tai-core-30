/**
 * The model stage, called from the workspace.
 *
 * The packet is assembled here, under the signed-in person's RLS, sent to the
 * reasoning endpoint, and everything that comes back is verified against that
 * same packet before it is trusted. If reasoning is unavailable for any reason
 * — no provider, no session, a refusal — the caller keeps its deterministic
 * read rather than losing the surface.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { Hypothesis, Observation } from "@/domain/intelligence-engine";

import type { EvidencePacket } from "./engine/hypothesise";
import { verifyHypotheses, type RawHypothesis } from "./engine/verify";

const ENDPOINT = "/api/public/intelligence/reason";

export interface ReasonResult {
  hypotheses: Hypothesis[];
  /** Claims the verifier refused, and why. Shown on request, never hidden. */
  rejected: { claim: string; because: string }[];
  available: boolean;
}

export async function reasonAboutBusiness(input: {
  organizationId: string;
  packet: EvidencePacket;
  observations: Observation[];
  now: string;
}): Promise<ReasonResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { hypotheses: [], rejected: [], available: false };

  let raw: RawHypothesis[] = [];
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ organization_id: input.organizationId, packet: input.packet }),
    });
    const body = (await response.json()) as { hypotheses?: RawHypothesis[] };
    if (!response.ok) return { hypotheses: [], rejected: [], available: false };
    raw = Array.isArray(body.hypotheses) ? body.hypotheses : [];
  } catch {
    return { hypotheses: [], rejected: [], available: false };
  }

  const verified = verifyHypotheses({
    raw,
    observations: input.observations,
    now: input.now,
    decided: input.packet.decided,
    suppressed: input.packet.suppressed,
  });

  return { ...verified, available: true };
}
