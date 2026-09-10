/**
 * What Studio knows before it writes a brief.
 *
 * The same shared retrieval bundle Comms, Steward and Scout reason over, and
 * for the same reason: one governed read of the workspace, with provenance,
 * so a brief cannot quietly contradict what a person already decided.
 *
 * Pure. No fetching, no model calls, no writes.
 *
 * Provenance laws expressed in the packet shape:
 *  - human corrections are read first and outrank every inference,
 *  - observed search evidence is evidence, never an instruction to write,
 *  - Studio's own reading is derived context and may never be restated as an
 *    observed fact,
 *  - a source that could not be read stays unknown; absence is never evidence.
 */

import type { IntelligenceCase } from "@/domain/intelligence-canon";
import type { RuntimeEvidenceInput } from "@/domain/intelligence-runtime";
import type { WithheldSource } from "@/domain/signals";
import {
  bundleForModel,
  composeRetrieval,
  type RetrievalBundle,
} from "@/data/intelligence/runtime/retrieval";

const TIER_ORDER: Record<string, number> = { decided: 0, observed: 1, derived: 2 };

export interface StudioRetrievalInput {
  organizationId: string;
  now?: string;
  /** What the brief is about: the phrase people actually typed. */
  subject: string;
  /** Observed search evidence, said plainly. Unknown metrics are omitted. */
  observed?: string[];
  /** Pages we already own that speak to this. Observed, from the inventory. */
  knownPages?: { path: string; title: string }[];
  /** Statements a person decided, including their corrections to this row. */
  decided?: string[];
  /** Studio's own reading so far. Context only, never a fact. */
  derived?: string[];
  cases?: IntelligenceCase[];
  withheld?: WithheldSource[];
}

export function composeStudioRetrieval(input: StudioRetrievalInput): RetrievalBundle {
  const evidence: RuntimeEvidenceInput[] = [];

  (input.observed ?? []).forEach((statement, index) => {
    evidence.push({
      id: `studio:observed:${index}`,
      statement,
      owningRoom: "website",
      tier: "observed",
      label: "Observed in Search Console over the reported window",
    });
  });

  (input.knownPages ?? []).forEach((page, index) => {
    evidence.push({
      id: `studio:page:${index}`,
      statement: `${page.title} (${page.path})`,
      owningRoom: "website",
      tier: "observed",
      label: "A page this workspace already publishes",
    });
  });

  (input.derived ?? []).forEach((statement, index) => {
    evidence.push({
      id: `studio:derived:${index}`,
      statement,
      owningRoom: "studio",
      tier: "derived",
      label: "Studio's own reading, context only, never a fact",
    });
  });

  return composeRetrieval({
    organizationId: input.organizationId,
    room: "studio",
    now: input.now ?? new Date().toISOString(),
    evidence,
    decided: input.decided ?? [],
    ...(input.cases ? { cases: input.cases } : {}),
    ...(input.withheld && input.withheld.length > 0 ? { withheld: input.withheld } : {}),
    contextPacket: null,
  });
}

/** The serialized packet a Studio brief call may see. Corrections first. */
export function studioRetrievalPacket(
  bundle: RetrievalBundle,
  subject?: string,
): Record<string, unknown> {
  const base = bundleForModel(bundle);
  const evidence = [...(base["evidence"] as { tier: string }[])].sort(
    (left, right) => (TIER_ORDER[left.tier] ?? 3) - (TIER_ORDER[right.tier] ?? 3),
  );

  return {
    humanCorrections: bundle.corrections.map((entry) => ({
      id: entry.id,
      lesson: entry.lesson ?? entry.hypothesis,
      correction: entry.correction ?? "",
      decidedAt: entry.decidedAt,
    })),
    priorCases: bundle.priorCases.map((ref) => ({
      caseId: ref.caseId,
      pattern: ref.patternName,
      ...(ref.outcome
        ? { outcome: `${ref.outcome.result} (${ref.outcome.decision}), ${ref.outcome.because}` }
        : {}),
    })),
    knowledgeProvenance: bundle.knowledge,
    ...(subject ? { subject } : {}),
    ...base,
    evidence,
  };
}

/** How the packet must be read. Provenance, in words, for a Studio prompt. */
export const STUDIO_RETRIEVAL_LAWS = [
  'The request carries "retrieval": the shared, governed read of what this workspace already knows. Read it before anything else.',
  "retrieval.humanCorrections are decisions a person already made. They outrank every inference, permanently. Never contradict one.",
  'retrieval.evidence is ordered strongest first: tier "decided" then "observed" may be relied on; tier "derived" is Studio\'s own inference and may never be restated as observed fact.',
  "Observed search numbers are evidence of what people asked for. They are never a claim about results, and you must not invent any number that is not there.",
  "retrieval.withheld lists sources that could not be read. They stay UNKNOWN. An unread source is never zero.",
  "Nothing you write is published, scheduled or sent. A person edits and keeps the brief, and decides separately whether anything is written.",
].join(" ");
