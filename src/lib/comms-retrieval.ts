/**
 * What Comms knows before it reasons.
 *
 * Comms drafting used to hand the model a hand-built evidence packet only.
 * This module routes the same, already-RLS-read sources through the shared
 * Intelligence Runtime retrieval bundle (`composeRetrieval`), so Comms reasons
 * over the same provenance-tagged structure every other room will use.
 *
 * Pure: no fetching, no model calls, no writes. Governance (the grounding
 * gate, the ask gate, the send gate) stays in code and is untouched here.
 *
 * Two laws are expressed in the packet shape itself:
 *  - human corrections are hoisted ahead of everything inferred,
 *  - a source that could not be read stays withheld and unknown; it never
 *    becomes a zero or a default fact.
 */

import type { IntelligenceCase } from "@/domain/intelligence-canon";
import type { RuntimeEvidenceInput } from "@/domain/intelligence-runtime";
import type { WithheldSource } from "@/domain/signals";
import {
  bundleForModel,
  composeRetrieval,
  type RetrievalBundle,
} from "@/data/intelligence/runtime/retrieval";

import type { ContextLine } from "@/lib/comms-context.server";

export interface CommsRetrievalInput {
  organizationId: string;
  relationshipId: string;
  now?: string;
  /** Relationship memory, already separated by the caller. */
  observedAndDecided: { label: string; value: string; tier: string }[];
  inferred: { label: string; value: string }[];
  /** The bounded project layer, evidence and interpretation kept apart. */
  contextLines: ContextLine[];
  trajectory: string[];
  /** Case ledger for this workspace; corrections are lifted out of it. */
  cases?: IntelligenceCase[];
  /** Sources that could not be read. They stay unknown, never zero. */
  withheld?: WithheldSource[];
}

const TIER_ORDER: Record<string, number> = { decided: 0, observed: 1, derived: 2 };

/**
 * Compose the Comms retrieval bundle from sources the caller already read
 * under RLS. Decided memory becomes decided-tier statements, observed memory
 * observed evidence, inferred memory derived evidence that is explicitly
 * marked guide-only, and the project layer keeps its own provenance.
 */
export function composeCommsRetrieval(input: CommsRetrievalInput): RetrievalBundle {
  const evidence: RuntimeEvidenceInput[] = [];

  input.observedAndDecided.forEach((entry, index) => {
    if (entry.tier === "decided") return; // carried as decided statements below
    evidence.push({
      id: `comms:memory:${index}`,
      statement: `${entry.label}: ${entry.value}`,
      owningRoom: "comms",
      tier: "observed",
      label: "Relationship memory, observed",
    });
  });

  input.inferred.forEach((entry, index) => {
    evidence.push({
      id: `comms:inferred:${index}`,
      statement: `${entry.label}: ${entry.value}`,
      owningRoom: "comms",
      tier: "derived",
      label: "Inferred, may guide the angle, never stated as fact",
    });
  });

  input.contextLines.forEach((line, index) => {
    evidence.push({
      id: `comms:context:${line.source}:${index}`,
      statement: line.text,
      owningRoom: line.source === "communication" ? "comms" : "projects",
      tier: line.kind === "evidence" ? "observed" : "derived",
      label:
        line.kind === "evidence"
          ? `Project layer, ${line.source}`
          : `Project layer, interpretation only`,
    });
  });

  input.trajectory.forEach((reading, index) => {
    evidence.push({
      id: `comms:trajectory:${index}`,
      statement: reading,
      owningRoom: "projects",
      tier: "derived",
      label: "Trajectory reading, interpretation only",
    });
  });

  const decided = input.observedAndDecided
    .filter((entry) => entry.tier === "decided")
    .map((entry) => `${entry.label}: ${entry.value}`);

  return composeRetrieval({
    organizationId: input.organizationId,
    room: "comms",
    now: input.now ?? new Date().toISOString(),
    evidence,
    decided,
    ...(input.cases ? { cases: input.cases } : {}),
    ...(input.withheld ? { withheld: input.withheld } : {}),
  });
}

/**
 * The serialized packet the drafting passes may see. It is the shared
 * `bundleForModel` output with two Comms-facing guarantees layered on top:
 * corrections are hoisted to the front, and evidence is ordered decided,
 * then observed, then derived, so weaker inference can never read as the
 * strongest thing in the packet.
 */
export function commsRetrievalPacket(bundle: RetrievalBundle): Record<string, unknown> {
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
