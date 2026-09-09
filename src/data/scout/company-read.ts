/**
 * Scout's company read, the first pilot of the Shared Intelligence Read.
 *
 * One read per company, many projections. Scout's surfaces (People, Approach
 * First, the handoff brief, the company overview) each derive meaning from the
 * same company today, independently, which is how two surfaces end up saying
 * different things about one business. This composer folds what Scout already
 * retrieved, the shared retrieval bundle plus canonically resolved people,
 * into one `IntelligenceRead`.
 *
 * Deliberate boundaries for this pass:
 *  - pure: no fetching, no model calls, no writes, no new research source
 *  - no new store: the read is composed per request over canonical truth
 *  - nothing is saved, scored, moved or sent from a read
 *  - identity is reused, never invented: canonical people arrive already
 *    resolved and enter as observed claims with their own provenance
 *
 * This composer is not yet consumed by a Scout surface. It is contract-level
 * only, so no visible behaviour changes.
 */

import {
  composeIntelligenceRead,
  type IntelligenceRead,
  type ReadClaim,
  type ReadRecommendation,
  type ReadSubject,
  type ReadTier,
} from "@/domain/intelligence-read";
import type { RetrievalBundle } from "@/data/intelligence/runtime/retrieval";

/** A person already resolved from canonical Trust Tai data. Never inferred. */
export interface ResolvedCompanyPerson {
  /** Canonical id when the person is already on record. */
  id?: string;
  name: string;
  title?: string | null;
  email?: string | null;
  /** Where the canonical record lives, e.g. "contacts", "profiles". */
  sourceLabel: string;
  /** When the record was last confirmed or written. */
  at?: string;
}

export interface ScoutCompanyReadInput {
  bundle: RetrievalBundle;
  subject: ReadSubject;
  /** People already resolved canonically for this company. */
  people?: ResolvedCompanyPerson[];
  /**
   * Aspect for a given evidence ref, when the caller knows two refs speak to
   * the same facet (for example a website domain and a corrected domain).
   * Unmapped evidence gets its own aspect, so nothing conflicts by accident.
   */
  aspects?: Record<string, string>;
  /** Named gaps the caller already knows about. */
  unknowns?: string[];
  /** Suggestions to carry. They stay suggestions; nothing acts on them. */
  recommendations?: ReadRecommendation[];
  /** True only when a model actually interpreted part of this read. */
  reasonedByModel?: boolean;
}

/** Bundle tiers map onto read tiers; "derived" is Scout's own inference. */
function tierOf(tier: "observed" | "decided" | "derived"): ReadTier {
  if (tier === "decided") return "decided";
  if (tier === "observed") return "observed";
  return "inferred";
}

/**
 * Compose one coherent read of a company from what Scout already knows.
 * Precedence, conflict retention, confidence and provenance are handled by
 * the shared contract; this function only decides what enters the read.
 */
export function composeScoutCompanyRead(input: ScoutCompanyReadInput): IntelligenceRead {
  const { bundle } = input;
  const aspects = input.aspects ?? {};
  const claims: ReadClaim[] = [];

  for (const item of bundle.evidence) {
    const tier = tierOf(item.tier);
    claims.push({
      id: item.id,
      aspect: aspects[item.id] ?? item.id,
      statement: item.statement,
      tier,
      origin: tier === "decided" ? "human" : tier === "observed" ? "observed" : "deterministic",
      at: bundle.now,
      evidenceRefs: [item.id],
      sources: [{ label: item.label ?? item.owningRoom, appId: item.owningRoom }],
      ...(tier === "inferred" ? { because: "Scout's own reading of the evidence." } : {}),
    });
  }

  /* Canonical people are known, not researched. They enter observed with the
     canonical record as their source, so no surface re-infers a founder. */
  (input.people ?? []).forEach((person, index) => {
    const ref = person.id ? `scout:resolved-person:${person.id}` : `scout:resolved-person:${index}`;
    claims.push({
      id: ref,
      aspect: aspects[ref] ?? "person",
      statement: [person.name, person.title, person.email].filter(Boolean).join(" - "),
      tier: "observed",
      origin: "observed",
      at: person.at ?? bundle.now,
      evidenceRefs: [ref],
      sources: [{ label: person.sourceLabel, appId: "scout" }],
    });
  });

  /* A human correction outranks inference permanently. It enters decided, and
     the inference it corrects stays visible as a conflict. */
  for (const entry of bundle.corrections) {
    const ref = `case:${entry.id}`;
    claims.push({
      id: ref,
      aspect: aspects[ref] ?? "correction",
      statement: entry.correction ?? entry.humanDecision,
      tier: "decided",
      origin: "human",
      at: entry.decidedAt,
      evidenceRefs: [ref],
      sources: [{ label: "Corrected by a person", appId: "intelligence_cases" }],
    });
  }

  return composeIntelligenceRead({
    organizationId: bundle.organizationId,
    room: "scout",
    subject: input.subject,
    asOf: bundle.now,
    claims,
    unknowns: input.unknowns ?? [],
    withheld: bundle.withheld,
    recommendations: input.recommendations ?? [],
    capabilities: {
      executable: bundle.capabilities.executable.map((cap) => cap.operation),
      unavailable: bundle.capabilities.unavailable.map((cap) => ({
        operation: cap.operation,
        because: cap.because ?? "not routable",
      })),
      externalSurfaces: bundle.capabilities.externalSurfaces,
      readOnly: bundle.capabilities.readOnly,
    },
    knowledgeRefs: bundle.knowledge.map((ref) => ref.id),
    ...(input.reasonedByModel === true ? { reasonedByModel: true } : {}),
  });
}
