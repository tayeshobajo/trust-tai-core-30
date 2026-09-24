/**
 * Principle lifecycle: the pure state machine for organizational principles
 * (Step 5 Learning Engine, Tai's rulings 2026-09-24).
 *
 * Lifecycle (ruling 6, decay included):
 *   provisional -> active -> strengthened
 *   active | strengthened -> challenged     (new contradicting evidence)
 *   challenged -> strengthened | superseded | retired
 * Nothing is ever deleted; superseded and retired are terminal states that
 * preserve what changed and why. The database trigger enforces the same
 * moves; this module is the one place the rules are readable and testable.
 *
 * Promotion (ruling 1): >= 3 units across >= 2 relationships, and CONTEXT
 * DIVERSITY gates universality: a principle whose evidence all shares one
 * context tag stays scoped to that tag; universality needs >= 2 distinct
 * tags. source = tai_confirmed promotes immediately, but evidence and scope
 * are preserved: even Tai-taught principles can be discovered to no longer
 * produce expected outcomes.
 *
 * Pure: no I/O, no model calls, no clocks unless passed in.
 */

import type { PrincipleDomain } from "@/domain/learning-unit";

export type PrincipleStatus =
  | "provisional"
  | "active"
  | "strengthened"
  | "challenged"
  | "superseded"
  | "retired";

export type PrincipleSource = "inferred" | "tai_confirmed";

export interface EvidenceRef {
  unitId: string;
  relationshipId: string | null;
  contextTags: string[];
  capturedAt: string;
  note?: string;
}

export interface Principle {
  id: string;
  organizationId: string;
  principle: string;
  scope: { domain: PrincipleDomain; contextTags: string[] };
  status: PrincipleStatus;
  source: PrincipleSource;
  confidence: number;
  supportingEvidence: EvidenceRef[];
  contradictingEvidence: EvidenceRef[];
  contextsObserved: string[];
  relationshipsObserved: string[];
  lastValidatedAt: string | null;
  supersededBy: string | null;
  transitionReason: string | null;
}

/** States whose principles flow into retrieval. Provisional influences nothing. */
export const INFLUENCING_STATUSES: readonly PrincipleStatus[] = ["active", "strengthened"];

const LAWFUL: Record<PrincipleStatus, PrincipleStatus[]> = {
  provisional: ["active", "retired"],
  active: ["strengthened", "challenged"],
  strengthened: ["challenged"],
  challenged: ["strengthened", "superseded", "retired"],
  superseded: [],
  retired: [],
};

export function canTransition(from: PrincipleStatus, to: PrincipleStatus): boolean {
  return LAWFUL[from].includes(to);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

/* ------------------------------------------------------------- promotion */

export interface PromotionReading {
  eligible: boolean;
  /** When eligible: the scope the principle has actually earned. */
  earnedScope: { domain: PrincipleDomain; contextTags: string[] } | null;
  /** Universal within its domain (>= 2 distinct context tags), or tag-scoped. */
  universalWithinDomain: boolean;
  because: string;
}

/**
 * Promotion eligibility from evidence. The scope is EARNED, never assumed:
 * evidence all sharing one context tag promotes scoped to that tag only.
 */
export function promotionReading(principle: Principle): PromotionReading {
  const units = dedupe(principle.supportingEvidence.map((entry) => entry.unitId));
  const relationships = dedupe(
    principle.supportingEvidence
      .map((entry) => entry.relationshipId)
      .filter((id): id is string => Boolean(id)),
  );
  const tags = dedupe(principle.supportingEvidence.flatMap((entry) => entry.contextTags));

  if (principle.source === "tai_confirmed") {
    return {
      eligible: true,
      earnedScope: {
        domain: principle.scope.domain,
        contextTags: tags.length > 0 ? tags : principle.scope.contextTags,
      },
      universalWithinDomain: tags.length >= 2,
      because:
        "Tai confirmed this principle explicitly; it promotes immediately with its evidence and scope preserved.",
    };
  }

  if (units.length < 3 || relationships.length < 2) {
    return {
      eligible: false,
      earnedScope: null,
      universalWithinDomain: false,
      because: `Needs >= 3 units across >= 2 relationships; has ${units.length} unit(s) across ${relationships.length} relationship(s).`,
    };
  }

  const universal = tags.length >= 2;
  return {
    eligible: true,
    earnedScope: { domain: principle.scope.domain, contextTags: tags },
    universalWithinDomain: universal,
    because: universal
      ? `Evidence spans ${tags.length} distinct contexts; the principle generalizes within its domain.`
      : `All evidence shares one context (${tags[0] ?? "none"}); the principle stays scoped to it.`,
  };
}

/* ------------------------------------------------------------- evidence */

export interface EvidenceApplication {
  principle: Principle;
  transition: { from: PrincipleStatus; to: PrincipleStatus; reason: string } | null;
  /** Contradictions never auto-resolve: this flags the pair for Tai. */
  flagForTai: string | null;
}

/**
 * Apply one supporting evidence ref. Supporting evidence raises confidence
 * a little, extends contexts and relationships observed, and can promote a
 * provisional principle (when the reading says so) or strengthen an active
 * one that keeps validating.
 */
export function applySupportingEvidence(
  principle: Principle,
  evidence: EvidenceRef,
  now: string,
): EvidenceApplication {
  if (principle.status === "superseded" || principle.status === "retired") {
    return { principle, transition: null, flagForTai: null };
  }
  let next: Principle = {
    ...principle,
    supportingEvidence: [...principle.supportingEvidence, evidence],
    contextsObserved: dedupe([...principle.contextsObserved, ...evidence.contextTags]),
    relationshipsObserved: dedupe([
      ...principle.relationshipsObserved,
      ...(evidence.relationshipId ? [evidence.relationshipId] : []),
    ]),
    confidence: clamp01(principle.confidence + 0.05),
    lastValidatedAt: now,
  };

  let transition: EvidenceApplication["transition"] = null;

  if (next.status === "provisional") {
    const reading = promotionReading(next);
    if (reading.eligible && reading.earnedScope) {
      next = {
        ...next,
        status: "active",
        scope: reading.earnedScope,
        transitionReason: reading.because,
      };
      transition = { from: "provisional", to: "active", reason: reading.because };
    }
  } else if (next.status === "active") {
    /* An active principle that keeps validating across contexts strengthens. */
    if (next.supportingEvidence.length >= 5 && next.contextsObserved.length >= 2) {
      const reason = "Evidence kept validating across contexts and relationships.";
      next = { ...next, status: "strengthened", transitionReason: reason };
      transition = { from: "active", to: "strengthened", reason };
    }
  } else if (next.status === "challenged") {
    /* Fresh supporting evidence answers a challenge; the resolution itself
       still goes through resolveChallenge so Tai's gate is explicit. */
  }

  return { principle: next, transition, flagForTai: null };
}

/**
 * Apply one contradicting evidence ref. Confidence drops; an influencing
 * principle moves to challenged; the contradiction is flagged for Tai and
 * NEVER auto-resolved (an exception, not traffic: the world or Tai changed).
 */
export function applyContradictingEvidence(
  principle: Principle,
  evidence: EvidenceRef,
  now: string,
): EvidenceApplication {
  if (principle.status === "superseded" || principle.status === "retired") {
    return { principle, transition: null, flagForTai: null };
  }
  let next: Principle = {
    ...principle,
    contradictingEvidence: [...principle.contradictingEvidence, evidence],
    confidence: clamp01(principle.confidence - 0.15),
    lastValidatedAt: now,
  };
  let transition: EvidenceApplication["transition"] = null;
  if (next.status === "active" || next.status === "strengthened") {
    const reason = `Contradicting evidence from unit ${evidence.unitId} challenged this principle.`;
    transition = { from: next.status, to: "challenged", reason };
    next = { ...next, status: "challenged", transitionReason: reason };
  }
  return {
    principle: next,
    transition,
    flagForTai: `Principle "${principle.principle}" is contradicted by unit ${evidence.unitId}. Contradictions never auto-resolve; this needs Tai.`,
  };
}

/* ----------------------------------------------------------- resolution */

export type ChallengeResolution =
  | { kind: "strengthen"; reason: string }
  | { kind: "supersede"; replacementId: string; reason: string }
  | { kind: "retire"; reason: string };

/**
 * Resolve a challenged principle. Only Tai (or a Tai-authorized consolidation
 * decision carrying his ruling) calls this; the engine itself only flags.
 * History is preserved in every branch: evidence stays, the reason is
 * recorded, and supersession links the replacement.
 */
export function resolveChallenge(principle: Principle, resolution: ChallengeResolution): Principle {
  if (principle.status !== "challenged") {
    throw new Error(`Only a challenged principle can be resolved; this one is ${principle.status}.`);
  }
  if (resolution.kind === "strengthen") {
    return {
      ...principle,
      status: "strengthened",
      confidence: clamp01(principle.confidence + 0.1),
      transitionReason: resolution.reason,
    };
  }
  if (resolution.kind === "supersede") {
    return {
      ...principle,
      status: "superseded",
      supersededBy: resolution.replacementId,
      transitionReason: resolution.reason,
    };
  }
  return { ...principle, status: "retired", transitionReason: resolution.reason };
}
