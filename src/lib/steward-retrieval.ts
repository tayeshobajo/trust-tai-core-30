/**
 * What Steward knows before it reads a meeting.
 *
 * Steward used to hand the model a hand-built memory object only. This module
 * routes the same, already-RLS-read sources through the shared Intelligence
 * Runtime retrieval bundle (`composeRetrieval`), so Steward reasons over the
 * same provenance-tagged structure every other room uses.
 *
 * Pure: no fetching, no model calls, no writes. Governance (candidate
 * detection, the interpretation shape, confirmation by a person) stays in code
 * and is untouched here.
 *
 * Three laws are expressed in the packet shape itself:
 *  - human corrections and decided memory are hoisted ahead of inference,
 *  - inferred memory stays derived and may never be stated as fact,
 *  - a source that could not be read stays withheld and unknown; it never
 *    becomes a zero or a default fact.
 */

import type { IntelligenceCase } from "@/domain/intelligence-canon";
import type { RuntimeEvidenceInput } from "@/domain/intelligence-runtime";
import type { WithheldSource } from "@/domain/signals";
import type { MemoryContext } from "@/domain/steward-semantic";
import {
  bundleForModel,
  composeRetrieval,
  type RetrievalBundle,
} from "@/data/intelligence/runtime/retrieval";

export interface StewardRetrievalInput {
  organizationId: string;
  now?: string;
  /** Canonical memory exactly as the caller read it. Unavailable is honest. */
  memory: MemoryContext;
  /** Case ledger for this workspace; corrections are lifted out of it. */
  cases?: IntelligenceCase[];
  /** Sources that could not be read. They stay unknown, never zero. */
  withheld?: WithheldSource[];
}

const TIER_ORDER: Record<string, number> = { decided: 0, observed: 1, derived: 2 };

/**
 * Compose the Steward retrieval bundle from sources the caller already read
 * under RLS. Decided memory becomes decided statements, canonical people,
 * projects and open commitments become observed evidence, and Steward's own
 * inferred memory becomes derived evidence marked context-only.
 *
 * Canonical people resolution is not repeated here: `memory.people` is already
 * the resolved list (role memory, then workspace members, then contacts), and
 * this module only carries it into the bundle.
 */
export function composeStewardRetrieval(input: StewardRetrievalInput): RetrievalBundle {
  const memory = input.memory;
  const evidence: RuntimeEvidenceInput[] = [];

  memory.people.forEach((person, index) => {
    evidence.push({
      id: `steward:person:${index}`,
      statement: [person.name, person.title].filter(Boolean).join(" - "),
      owningRoom: "steward",
      tier: "observed",
      label: "Canonical person already known to this workspace",
    });
  });

  memory.projects.forEach((project, index) => {
    evidence.push({
      id: `steward:project:${index}`,
      statement: project.label,
      owningRoom: "projects",
      tier: "observed",
      label: "Canonical project",
    });
  });

  memory.openCommitments.forEach((commitment, index) => {
    evidence.push({
      id: `steward:commitment:${index}`,
      statement: `${commitment.ownerName}: ${commitment.statement} (${commitment.status})`,
      owningRoom: "steward",
      tier: "observed",
      label: "Open commitment already recorded",
    });
  });

  (memory.inferred ?? []).forEach((statement, index) => {
    evidence.push({
      id: `steward:inferred:${index}`,
      statement,
      owningRoom: "steward",
      tier: "derived",
      label: "Steward's own reading, context only, never a fact",
    });
  });

  /* Memory that could not be read stays unknown rather than becoming empty. */
  const withheld: WithheldSource[] = [...(input.withheld ?? [])];
  if (!memory.available) {
    withheld.push({ appId: "steward_canonical_memory", reason: "not_connected" });
  }

  return composeRetrieval({
    organizationId: input.organizationId,
    room: "steward",
    now: input.now ?? new Date().toISOString(),
    evidence,
    decided: memory.decided ?? [],
    ...(input.cases ? { cases: input.cases } : {}),
    ...(withheld.length > 0 ? { withheld } : {}),
  });
}

/**
 * The serialized packet the interpretation call may see. It is the shared
 * `bundleForModel` output with two Steward-facing guarantees layered on top:
 * corrections are hoisted to the front, and evidence is ordered decided, then
 * observed, then derived, so weaker inference can never read as the strongest
 * thing in the packet.
 */
export function stewardRetrievalPacket(bundle: RetrievalBundle): Record<string, unknown> {
  const base = bundleForModel(bundle);
  const evidence = [...(base["evidence"] as { tier: string }[])].sort(
    (left, right) => (TIER_ORDER[left.tier] ?? 3) - (TIER_ORDER[right.tier] ?? 3),
  );

  return {
    /* Human corrections outrank inference, permanently, so they are read
       first. An empty list is an honest answer. */
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
    ...base,
    evidence,
  };
}
