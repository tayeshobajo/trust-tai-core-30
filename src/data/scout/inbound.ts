/**
 * Inbound companies: the ones that came to us.
 *
 * A company that completed the roadmap intake on TrustTai.com arrives with
 * testimony rather than evidence. Scout must show that clearly: it is the
 * strongest reason to look, and the weakest reason to believe.
 *
 * This module is the single place that decides whether a stored prospect is
 * inbound and how its stated lane is read back.
 */

import {
  STATED_LANE_LABEL,
  claimsInLane,
  readPacket,
  type FounderSignalPacket,
  type StatedLane,
} from "@/domain/stated";
import type { CandidateSource, ProspectCandidate, ScoutSignal } from "@/domain/scout";
import { WEBSITE_INTAKE_SOURCE } from "@/domain/scout";
import { WEBSITE_INTAKE_LABEL } from "@/domain/website";

/** The `prospects.source` value the receiver writes for an inbound company. */
export const WEBSITE_INTAKE_ROW_SOURCE = "website_roadmap_intake";

export interface InboundOrigin {
  packet: FounderSignalPacket;
  /** e.g. "Google Ads · Spring roadmap". Empty when the visit was direct. */
  channel: string;
  submittedAt: string;
}

/** Read the inbound origin of a stored company, or null if it is not inbound. */
export function inboundOrigin(input: {
  source?: string | null;
  metadata?: unknown;
}): InboundOrigin | null {
  const packet = readPacket(input.metadata);
  if (!packet) return null;
  const parts = [packet.attribution.utmSource, packet.attribution.utmCampaign].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return {
    packet,
    channel: parts.length > 0 ? parts.join(" · ") : "Direct",
    submittedAt: packet.statedAt,
  };
}

/** True when a company reached us rather than the other way round. */
export function isInbound(input: { source?: string | null; metadata?: unknown }): boolean {
  return input.source === WEBSITE_INTAKE_ROW_SOURCE || readPacket(input.metadata) !== null;
}

export function inboundSource(origin: InboundOrigin): CandidateSource {
  return {
    ...WEBSITE_INTAKE_SOURCE,
    label: WEBSITE_INTAKE_LABEL,
    researchedAt: origin.submittedAt,
  };
}

/**
 * Stated claims as Scout signals, explicitly marked inferred-not-observed so
 * nothing downstream mistakes testimony for something we checked.
 */
export function statedSignals(origin: InboundOrigin): ScoutSignal[] {
  return origin.packet.claims.slice(0, 12).map((claim, index) => ({
    id: `stated_${origin.packet.submissionId}_${index}`,
    statement: `${STATED_LANE_LABEL[claim.lane]}: ${claim.statement}`,
    provenance: {
      appId: "website",
      actor: { type: "system", id: "website.intake" },
      observedAt: origin.submittedAt,
      confidence: "inferred",
    },
  }));
}

/** The one-line reason an inbound company is worth a look, in their words. */
export function inboundFit(origin: InboundOrigin): { whyItFits: string; recommendation: string } {
  const wants = claimsInLane(origin.packet, "desired_future")[0];
  const pain = claimsInLane(origin.packet, "pains")[0];
  return {
    whyItFits: wants
      ? `They came to us and said they want: ${wants}`
      : "They completed the roadmap intake on TrustTai.com and asked for a path forward.",
    recommendation: pain
      ? `Read what they said, then confirm the cost they named: ${pain}`
      : "Read what they said before researching anything.",
  };
}

/** Lanes that actually have content, in reading order. */
export function filledLanes(
  packet: FounderSignalPacket,
  order: StatedLane[],
): { lane: StatedLane; statements: string[] }[] {
  return order
    .map((lane) => ({ lane, statements: claimsInLane(packet, lane) }))
    .filter((entry) => entry.statements.length > 0);
}

/** Overlay inbound origin onto a candidate built by the normal mappers. */
export function withInboundOrigin(
  candidate: ProspectCandidate,
  origin: InboundOrigin,
): ProspectCandidate {
  const stated = statedSignals(origin);
  return {
    ...candidate,
    stated: origin.packet,
    source: inboundSource(origin),
    signals: candidate.signals.length > 0 ? candidate.signals : stated,
    fit: candidate.signals.length > 0 ? candidate.fit : inboundFit(origin),
  };
}
