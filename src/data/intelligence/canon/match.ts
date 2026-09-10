/**
 * Pattern retrieval and matching.
 *
 * Deterministic first, and deterministic only for v1: no embeddings, no model,
 * no hidden weighting. A match is a claim that a known shape *may* be present,
 * and it always carries what supported it, what is missing, what argues against
 * it, and the other thing it could be.
 *
 * Two laws are enforced here rather than assumed:
 *
 *   - A match never changes an evidence lane. Each matched fact keeps the tier
 *     the observation arrived with, so testimony never becomes observation.
 *   - A match is never truth. Confidence is capped by the pattern and lowered
 *     again whenever the evidence is thin or something is missing.
 */

import type { ConfidenceLevel } from "@/domain/confidence";
import type { Observation } from "@/domain/intelligence-engine";
import {
  CANON_DOMAIN_LABEL,
  type CanonDomain,
  type EvidenceRequest,
  type IntelligencePattern,
  type MatchedEvidence,
  type PatternCondition,
  type PatternMatch,
} from "@/domain/intelligence-canon";

import { activePatterns } from "./patterns";

/** Below this a match is noise, not a reading. */
export const MATCH_FLOOR = 0.34;
/** A surface may put a short label on a match only at or above this. */
export const LABEL_THRESHOLD = 0.6;

export interface MatchQuery {
  observations: Observation[];
  /** Restrict to these domains. Empty or absent means the whole canon. */
  domains?: CanonDomain[];
  /** Pattern ids a person has told the workspace to stop raising. */
  suppressed?: string[];
  limit?: number;
}

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];

function lower(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

function satisfies(condition: PatternCondition, observation: Observation): boolean {
  if (observation.kind !== condition.observationKind) return false;
  if (condition.minMagnitude === undefined) return true;
  return (observation.magnitude ?? 0) >= condition.minMagnitude;
}

/** The lane the fact arrived in travels with it. Matching never promotes it. */
function toEvidence(observation: Observation): MatchedEvidence {
  return {
    observationId: observation.id,
    observationKind: observation.kind,
    statement: observation.statement,
    tier: observation.tier,
    sourceApps: observation.sourceApps,
    ...(observation.magnitude === undefined ? {} : { magnitude: observation.magnitude }),
  };
}

function requestFor(pattern: IntelligencePattern, condition: PatternCondition): EvidenceRequest {
  const named = pattern.evidenceToInspect.find((entry) =>
    entry.inspect.toLowerCase().includes(condition.observationKind.split("_")[0] ?? ""),
  );
  return (
    named ?? {
      inspect: condition.looksFor,
      appId: pattern.possibleNextMoves[0]?.appId ?? "conductor",
      wouldConfirm: `${condition.looksFor} is present`,
      wouldRefute: `${condition.looksFor} is absent`,
    }
  );
}

function labelFor(pattern: IntelligencePattern): string {
  return `Possible ${pattern.name.charAt(0).toLowerCase()}${pattern.name.slice(1)}`;
}

/** One pattern against the evidence. Returns nothing when the shape is absent. */
export function matchPattern(
  pattern: IntelligencePattern,
  observations: Observation[],
): PatternMatch | null {
  const required = pattern.triggers.filter((trigger) => !trigger.optional);
  const optional = pattern.triggers.filter((trigger) => trigger.optional);

  const matched: MatchedEvidence[] = [];
  const missingEvidence: EvidenceRequest[] = [];
  const unmetConditions: string[] = [];
  let requiredHits = 0;

  for (const condition of required) {
    const hit = observations.find((observation) => satisfies(condition, observation));
    if (hit) {
      requiredHits += 1;
      matched.push(toEvidence(hit));
    } else {
      missingEvidence.push(requestFor(pattern, condition));
      unmetConditions.push(condition.looksFor);
    }
  }

  /* No required condition met is not a weak match, it is a different situation. */
  if (requiredHits === 0) return null;

  let optionalHits = 0;
  for (const condition of optional) {
    const hit = observations.find((observation) => satisfies(condition, observation));
    if (hit) {
      optionalHits += 1;
      matched.push(toEvidence(hit));
    } else {
      unmetConditions.push(condition.looksFor);
    }
  }

  const contradicting: MatchedEvidence[] = [];
  for (const condition of pattern.negativeIndicators) {
    const hit = observations.find((observation) => satisfies(condition, observation));
    if (hit) contradicting.push(toEvidence(hit));
  }

  /* Required conditions carry the score; optional ones can only nudge it. */
  const requiredShare = requiredHits / Math.max(required.length, 1);
  const optionalShare = optional.length > 0 ? optionalHits / optional.length : 0;
  const raw = requiredShare * 0.8 + optionalShare * 0.2;
  const penalty = contradicting.length * 0.25;
  const score = Math.max(0, Math.round((raw - penalty) * 100) / 100);
  if (score < MATCH_FLOOR) return null;

  let confidence: ConfidenceLevel = pattern.confidenceCap;
  if (missingEvidence.length > 0) confidence = lower(confidence, "low");
  if (matched.length < 2) confidence = lower(confidence, "low");
  if (contradicting.length > 0) confidence = lower(confidence, "unknown");

  const because =
    `${matched.length} of ${pattern.triggers.length} things this shape usually shows are present` +
    (missingEvidence.length > 0
      ? `, and ${missingEvidence.length} could not be checked here.`
      : ".");

  return {
    patternId: pattern.id,
    patternName: pattern.name,
    domain: pattern.domain,
    score,
    because,
    matched,
    missingEvidence,
    unmetConditions,
    contradicting,
    competingExplanations: pattern.competingExplanations,
    ...(pattern.chainId ? { recommendedChainId: pattern.chainId } : {}),
    confidence,
    possibleNextMoves: pattern.possibleNextMoves,
    label: labelFor(pattern),
    evidence: matched.map((entry) => ({
      label: entry.statement,
      kind: "computed" as const,
    })),
  };
}

/** The whole canon against the evidence, best first. */
export function matchPatterns(query: MatchQuery): PatternMatch[] {
  const suppressed = new Set(query.suppressed ?? []);
  const domains = query.domains && query.domains.length > 0 ? new Set(query.domains) : null;

  const matches = activePatterns()
    .filter((pattern) => !suppressed.has(pattern.id))
    .filter((pattern) => !domains || domains.has(pattern.domain))
    .map((pattern) => matchPattern(pattern, query.observations))
    .filter((match): match is PatternMatch => match !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.matched.length - a.matched.length ||
        a.patternId.localeCompare(b.patternId),
    );

  return matches.slice(0, query.limit ?? 5);
}

/** One paragraph a surface can show without adding anything to the evidence. */
export function describeMatch(match: PatternMatch): string {
  const evidence = match.matched.map((entry) => entry.statement).join(" ");
  const competing = match.competingExplanations[0];
  const move = match.possibleNextMoves[0];
  const parts = [
    `Likely pattern: ${match.patternName.toLowerCase()} in ${CANON_DOMAIN_LABEL[match.domain].toLowerCase()}.`,
    evidence ? `Evidence: ${evidence}` : "",
    match.missingEvidence.length > 0
      ? `Not checked yet: ${match.missingEvidence.map((entry) => entry.inspect).join("; ")}.`
      : "",
    competing
      ? `It could also be that ${lowerFirst(competing.explanation)} ${competing.distinguishedBy}`
      : "",
    move ? `If it holds, the next move sits with ${move.appId}: ${lowerFirst(move.move)}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** A short label a surface may show, only when the evidence earns it. */
export function conciseLabel(match: PatternMatch): string | null {
  if (match.score < LABEL_THRESHOLD) return null;
  if (match.contradicting.length > 0) return null;
  return match.label;
}
