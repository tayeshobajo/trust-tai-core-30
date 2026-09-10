/**
 * What Scout knows before it reasons.
 *
 * Scout's discovery and import reads used to be hand-built prompts with their
 * own private context. This module routes the same, already-RLS-read sources
 * through the shared Intelligence Runtime retrieval bundle (`composeRetrieval`),
 * so Scout reasons over the same provenance-tagged structure Comms and Steward
 * use, and so Import, People and the handoff cannot drift into contradictory
 * readings of the same company.
 *
 * Pure: no fetching, no model calls, no writes. Governance stays in code and is
 * untouched here: duplicate detection, exact domain matching, observed-only
 * Movement, the explicit human save, and the no-send law.
 *
 * Three laws are expressed in the packet shape itself:
 *  - human corrections are read before anything inferred,
 *  - decided and observed truth outranks derived context, which may never be
 *    stated as fact,
 *  - a source that could not be read stays withheld and unknown; absence is
 *    never evidence.
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

/** A company this workspace already knows about, by canonical record. */
export interface KnownCompany {
  name: string;
  domain?: string | null;
  /** Why it is watched, when a person recorded it. */
  intent?: string | null;
}

/** A person already resolved from canonical Trust Tai data. Never re-inferred. */
export interface KnownPerson {
  name: string;
  title?: string | null;
  company?: string | null;
}

export interface ScoutRetrievalInput {
  organizationId: string;
  now?: string;
  /** What the read is about: a source label, a query, or a company. */
  subject: string;
  /** Canonical companies already on record. Duplicate law stays in code. */
  known?: KnownCompany[];
  /** People already resolved canonically. The model must not re-invent them. */
  people?: KnownPerson[];
  /** Observed evidence Scout already holds for the subject. */
  observed?: { statement: string; sourceUrl?: string | null }[];
  /** Statements a person decided, e.g. the active ICP or a human fit call. */
  decided?: string[];
  /** Scout's own reading so far. Context only, never a fact. */
  derived?: string[];
  /** Case ledger for this workspace; corrections are lifted out of it. */
  cases?: IntelligenceCase[];
  /** Sources that could not be read. They stay unknown, never zero. */
  withheld?: WithheldSource[];
}

/**
 * Compose the Scout retrieval bundle from sources the caller already read
 * under RLS. Canonical companies and people enter observed, human decisions
 * enter decided, Scout's own reading enters derived and is marked context
 * only, and anything unreadable is named as withheld.
 */
export function composeScoutRetrieval(input: ScoutRetrievalInput): RetrievalBundle {
  const evidence: RuntimeEvidenceInput[] = [];

  (input.known ?? []).forEach((company, index) => {
    const parts = [company.name, company.domain].filter(Boolean).join(" - ");
    evidence.push({
      id: `scout:company:${index}`,
      statement: company.intent ? `${parts} (watched because: ${company.intent})` : parts,
      owningRoom: "scout",
      tier: "observed",
      label: "Company already on record in this workspace",
    });
  });

  (input.people ?? []).forEach((person, index) => {
    evidence.push({
      id: `scout:person:${index}`,
      statement: [person.name, person.title, person.company].filter(Boolean).join(" - "),
      owningRoom: "scout",
      tier: "observed",
      label: "Person already known canonically, do not research again",
    });
  });

  (input.observed ?? []).forEach((entry, index) => {
    evidence.push({
      id: `scout:observed:${index}`,
      statement: entry.sourceUrl ? `${entry.statement} (${entry.sourceUrl})` : entry.statement,
      owningRoom: "scout",
      tier: "observed",
      label: "Observed evidence already held for this subject",
    });
  });

  (input.derived ?? []).forEach((statement, index) => {
    evidence.push({
      id: `scout:derived:${index}`,
      statement,
      owningRoom: "scout",
      tier: "derived",
      label: "Scout's own reading, context only, never a fact",
    });
  });

  return composeRetrieval({
    organizationId: input.organizationId,
    room: "scout",
    now: input.now ?? new Date().toISOString(),
    evidence,
    decided: input.decided ?? [],
    ...(input.cases ? { cases: input.cases } : {}),
    ...(input.withheld && input.withheld.length > 0 ? { withheld: input.withheld } : {}),
    contextPacket: null,
  });
}

/**
 * The serialized packet a Scout reasoning call may see. It is the shared
 * `bundleForModel` output with the Scout-facing guarantees layered on top:
 * corrections first, then evidence ordered decided, observed, derived, so
 * weaker inference can never read as the strongest thing in the packet.
 */
export function scoutRetrievalPacket(
  bundle: RetrievalBundle,
  subject?: string,
): Record<string, unknown> {
  const base = bundleForModel(bundle);
  const evidence = [...(base["evidence"] as { tier: string }[])].sort(
    (left, right) => (TIER_ORDER[left.tier] ?? 3) - (TIER_ORDER[right.tier] ?? 3),
  );

  return {
    /* Human corrections outrank inference, permanently, so they are read
       first. An empty list is an honest answer, never a reason to guess. */
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

/** How the packet must be read. Provenance, in words, for a Scout prompt. */
export const SCOUT_RETRIEVAL_LAWS = [
  'The request carries "retrieval": the shared, governed read of what this workspace already knows. Read it before anything else.',
  "retrieval.humanCorrections are decisions a person already made. They outrank every inference, permanently. Never contradict one.",
  'retrieval.evidence is ordered strongest first: tier "decided" then "observed" may be relied on; tier "derived" is Scout\'s own inference and may never be restated as observed fact.',
  "Companies and people already listed in retrieval.evidence are known. Reuse them exactly as written; never re-invent, re-spell or research them afresh.",
  "retrieval.withheld lists sources that could not be read. They stay UNKNOWN. An unread source is never zero and never evidence that something is absent.",
  "retrieval.capabilities describes what Scout can actually do. Nothing is saved, scored or sent from your answer; a person decides.",
].join(" ");
