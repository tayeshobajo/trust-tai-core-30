/**
 * The Shared Intelligence Read, one read per subject, many projections.
 *
 * Canon 27: a subject (a company, a client, a project, a person) is read once,
 * coherently, and every surface projects that same read. Surfaces stop
 * recomputing meaning over the same truth and therefore stop contradicting
 * each other.
 *
 * This file is pure contract plus small pure helpers. It owns no durable
 * state: an `IntelligenceRead` is a request-time projection over canonical,
 * room-owned truth. There is no read table, no snapshot store, and no write
 * path here. Every durable change still goes through the owning room's
 * services and its human gates.
 *
 * Two laws are expressed in the types themselves:
 *
 *  - Truth precedence: decided > observed > inferred > recommended > unknown,
 *    newer first within a tier. A claim that loses precedence is never
 *    silently dropped; it is carried in `conflicts` with its source, tier and
 *    timestamp so a person can see the disagreement.
 *  - Honest provenance: every claim says whether it was decided by a person,
 *    observed from a source, produced by deterministic governance, or
 *    interpreted by a model. Nothing pretends to be reasoning that was not.
 */

import type { ConfidenceLevel } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import { runtimeConfidence } from "./intelligence-runtime";

/* ---------------------------------------------------------------- subject */

/** What the read is about. Canonical id when one exists, never invented. */
export interface ReadSubject {
  /** Entity kind, e.g. "prospect", "client", "project", "contact". */
  type: string;
  /** Canonical id in the owning room, when the subject is already on record. */
  id?: ID;
  label: string;
  /** Stable secondary key, e.g. a company domain. Helps projections align. */
  key?: string;
}

/* ------------------------------------------------------------ truth tiers */

/**
 * The precedence law, strongest first. "recommended" is a suggestion, never a
 * statement about the world; "unknown" is an honest gap, never a zero.
 */
export type ReadTier = "decided" | "observed" | "inferred" | "recommended" | "unknown";

export const READ_TIER_ORDER: ReadTier[] = [
  "decided",
  "observed",
  "inferred",
  "recommended",
  "unknown",
];

export function tierRank(tier: ReadTier): number {
  const index = READ_TIER_ORDER.indexOf(tier);
  return index === -1 ? READ_TIER_ORDER.length : index;
}

/** How this part of the read came to exist. Never fake model reasoning. */
export type ReadOrigin =
  /** A person decided or corrected it. */
  | "human"
  /** Read directly from a source. */
  | "observed"
  /** Produced by deterministic governance in code. */
  | "deterministic"
  /** Interpreted by a model inside the shared runtime. */
  | "model";

export interface ReadSourceRef {
  label: string;
  url?: string;
  /** Room or app that owns the source, when known. */
  appId?: string;
}

/* ----------------------------------------------------------------- claims */

/**
 * One statement about the subject. `aspect` is what the claim is *about*
 * (for example "domain" or "founder"): two claims sharing an aspect are
 * candidates for conflict, claims with different aspects never conflict.
 */
export interface ReadClaim {
  id: string;
  /** The facet of the subject this claim speaks to. */
  aspect: string;
  statement: string;
  tier: ReadTier;
  origin: ReadOrigin;
  /** When the claim became true, or was last observed. */
  at: ISODateTime;
  /** Refs into the retrieval bundle this claim is grounded in. */
  evidenceRefs: string[];
  sources: ReadSourceRef[];
  /** One line of grounding for an inferred claim. */
  because?: string;
}

/** A disagreement kept visible. The losing claim is never discarded. */
export interface ReadConflict {
  aspect: string;
  leading: ReadClaim;
  losing: ReadClaim[];
  because: string;
}

/**
 * A suggestion. Non-authoritative by construction: it changes nothing, and
 * carries the human boundary it would need if a person chose to act.
 */
export interface ReadRecommendation {
  id: string;
  title: string;
  because: string;
  owningRoom: string;
  operation?: string;
  requiresApproval: boolean;
  origin: ReadOrigin;
  /** Always false. A recommendation is never a statement of truth. */
  authoritative: false;
}

export interface ReadCapabilities {
  executable: string[];
  unavailable: { operation: string; because: string }[];
  externalSurfaces: string[];
  readOnly: boolean;
}

/* ------------------------------------------------------------- the read */

export interface IntelligenceRead {
  organizationId: ID;
  subject: ReadSubject;
  /** The room that composed the read. Ownership never moves to the read. */
  room: string;
  asOf: ISODateTime;
  /** Leading claims, strongest tier first, newest first within a tier. */
  claims: ReadClaim[];
  /** Disagreements, with the losing claims intact. */
  conflicts: ReadConflict[];
  /** Named gaps. Silence is an answer; a gap is never a negative fact. */
  unknowns: string[];
  /** Sources that could not be read. Unknown, not zero. */
  withheld: { appId: string; reason: string }[];
  /** Suggestions only. Nothing here has changed or will change state. */
  recommendations: ReadRecommendation[];
  /** Never stronger than the grounded evidence behind it. */
  confidence: ConfidenceLevel;
  capabilities: ReadCapabilities;
  provenance: {
    evidenceRefs: string[];
    knowledgeRefs: string[];
    sources: ReadSourceRef[];
  };
  /**
   * How the read itself was produced. "deterministic" when no model was
   * consulted, "model" when every interpretation came from one, "mixed" when
   * deterministic governance and model interpretation both contributed.
   */
  producedBy: "deterministic" | "model" | "mixed";
}

/* ------------------------------------------------------------- resolution */

function newerFirst(left: ReadClaim, right: ReadClaim): number {
  return right.at.localeCompare(left.at);
}

/** Precedence, then recency. Total and deterministic. */
export function compareClaims(left: ReadClaim, right: ReadClaim): number {
  const byTier = tierRank(left.tier) - tierRank(right.tier);
  if (byTier !== 0) return byTier;
  const byTime = newerFirst(left, right);
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

export interface ResolvedClaims {
  leading: ReadClaim[];
  conflicts: ReadConflict[];
}

/**
 * Apply the truth law across claims. One leading claim per aspect; every
 * other claim about that aspect stays visible as a named conflict, with its
 * own source, tier and timestamp preserved exactly as supplied.
 */
export function resolveClaims(claims: ReadClaim[]): ResolvedClaims {
  const byAspect = new Map<string, ReadClaim[]>();
  for (const claim of claims) {
    const bucket = byAspect.get(claim.aspect);
    if (bucket) bucket.push(claim);
    else byAspect.set(claim.aspect, [claim]);
  }

  const leading: ReadClaim[] = [];
  const conflicts: ReadConflict[] = [];

  for (const [aspect, bucket] of byAspect) {
    const ordered = [...bucket].sort(compareClaims);
    const [winner, ...rest] = ordered;
    if (!winner) continue;
    leading.push(winner);

    /* Same statement said twice is agreement, not disagreement. */
    const disagreeing = rest.filter(
      (claim) => claim.statement.trim().toLowerCase() !== winner.statement.trim().toLowerCase(),
    );
    if (disagreeing.length > 0) {
      conflicts.push({
        aspect,
        leading: winner,
        losing: disagreeing,
        because:
          winner.tier === disagreeing[0]?.tier
            ? `More recent ${winner.tier} claim leads; the earlier claim is kept.`
            : `A ${winner.tier} claim outranks ${disagreeing
                .map((claim) => claim.tier)
                .join(", ")}; the other claim is kept.`,
      });
    }
  }

  leading.sort(compareClaims);
  conflicts.sort((left, right) => left.aspect.localeCompare(right.aspect));
  return { leading, conflicts };
}

/* -------------------------------------------------------------- composing */

export interface IntelligenceReadInput {
  organizationId: ID;
  room: string;
  subject: ReadSubject;
  asOf: ISODateTime;
  claims: ReadClaim[];
  unknowns?: string[];
  withheld?: { appId: string; reason: string }[];
  recommendations?: ReadRecommendation[];
  capabilities: ReadCapabilities;
  knowledgeRefs?: string[];
  /** True only when a model actually interpreted something in this read. */
  reasonedByModel?: boolean;
}

const GROUNDED: ReadTier[] = ["decided", "observed"];

/**
 * Compose one coherent read. Pure: no fetching, no model calls, no writes.
 * Confidence is derived from grounded (decided or observed) leading claims,
 * so inference can never talk the read into sounding sure.
 */
export function composeIntelligenceRead(input: IntelligenceReadInput): IntelligenceRead {
  const { leading, conflicts } = resolveClaims(input.claims);

  const groundedCount = leading.filter((claim) => GROUNDED.includes(claim.tier)).length;
  const confidence = runtimeConfidence(groundedCount);

  const usedModel = input.reasonedByModel === true || leading.some((c) => c.origin === "model");
  const usedDeterministic = leading.some(
    (claim) => claim.origin !== "model" || input.reasonedByModel !== true,
  );
  const producedBy: IntelligenceRead["producedBy"] = usedModel
    ? usedDeterministic
      ? "mixed"
      : "model"
    : "deterministic";

  const sources: ReadSourceRef[] = [];
  const seen = new Set<string>();
  for (const claim of [...leading, ...conflicts.flatMap((entry) => entry.losing)]) {
    for (const source of claim.sources) {
      const key = `${source.label}|${source.url ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
  }

  return {
    organizationId: input.organizationId,
    room: input.room,
    subject: input.subject,
    asOf: input.asOf,
    claims: leading,
    conflicts,
    unknowns: input.unknowns ?? [],
    withheld: input.withheld ?? [],
    recommendations: (input.recommendations ?? []).map((entry) => ({
      ...entry,
      authoritative: false as const,
    })),
    confidence,
    capabilities: input.capabilities,
    provenance: {
      evidenceRefs: [...new Set(leading.flatMap((claim) => claim.evidenceRefs))],
      knowledgeRefs: input.knowledgeRefs ?? [],
      sources,
    },
    producedBy,
  };
}

/** Every claim in the read, leading and losing, for provenance surfaces. */
export function allClaims(read: IntelligenceRead): ReadClaim[] {
  return [...read.claims, ...read.conflicts.flatMap((entry) => entry.losing)];
}
