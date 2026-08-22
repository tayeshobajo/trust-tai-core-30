/**
 * Retrieval composition — what the runtime knows before it reasons.
 *
 * One composition point for every room: the caller assembles sources under
 * RLS (its own services, the intelligence service, the context packet), and
 * this module normalizes them into a single bundle with provenance on every
 * item. The bundle is what the reasoning stage may see — all of it, and
 * nothing beyond it.
 *
 * Sources composed here:
 * - the room's evidence (observed / decided / derived statements)
 * - human decisions, which outrank inference
 * - withheld rooms, which stay unknown
 * - canon pattern matches (what the suite has learned to recognize)
 * - prior experience (cases and pattern outcomes, corrections first)
 * - the suite capability view (what the room can actually do)
 * - context packets (structured room state, e.g. Projects)
 *
 * Pure: no fetching, no model calls.
 */

import type { ID } from "@/domain/entities";
import type {
  CanonDomain,
  IntelligenceCase,
  PatternMatch,
  PatternOutcome,
} from "@/domain/intelligence-canon";
import type {
  RetrievedKnowledgeRef,
  RuntimeEvidenceInput,
  RuntimeRoom,
} from "@/domain/intelligence-runtime";
import { roomCapabilities, type CapabilityAnswer } from "@/domain/intelligence-capabilities";
import type { Observation } from "@/domain/intelligence-engine";
import type { WithheldSource } from "@/domain/signals";

import { experienceForMatches, type PriorExperience } from "../canon/experience";
import { matchPatterns } from "../canon/match";

export interface RetrievalBundle {
  organizationId: ID;
  room: RuntimeRoom;
  now: string;
  /** Evidence, provenance-tagged. Cross-room items are read-only context. */
  evidence: RuntimeEvidenceInput[];
  /** Statements a person decided. Inference never overrides these. */
  decided: string[];
  /** Rooms that could not be read. The read never guesses about them. */
  withheld: { appId: string; reason: string }[];
  /** Canon shapes the evidence matches. */
  patterns: PatternMatch[];
  /** What the organization has seen before, per matched pattern. */
  priorExperience: Record<string, PriorExperience>;
  /** Human corrections, always surfaced ahead of inference. */
  corrections: IntelligenceCase[];
  /** What the asking room can really do. */
  capabilities: CapabilityAnswer;
  /** Knowledge refs handed to the read for its provenance list. */
  knowledge: RetrievedKnowledgeRef[];
}

export interface RetrievalInput {
  organizationId: ID;
  room: RuntimeRoom;
  now: string;
  evidence: RuntimeEvidenceInput[];
  decided?: string[];
  withheld?: WithheldSource[];
  /** Engine observations, when the caller has them — canon matches run on these. */
  observations?: Observation[];
  /** Restrict canon matching to these domains. */
  canonDomains?: CanonDomain[];
  /** Pattern ids a person has told the workspace to stop raising. */
  suppressed?: string[];
  /** Experience ledger inputs, when the caller has them. */
  cases?: IntelligenceCase[];
  outcomes?: PatternOutcome[];
  /** A structured context packet the caller assembled (e.g. Projects). */
  contextPacket?: { id: string; title: string; statements: string[] } | null;
}

export function composeRetrieval(input: RetrievalInput): RetrievalBundle {
  const decided = input.decided ?? [];
  const withheld = (input.withheld ?? []).map((row) => ({ appId: row.appId, reason: row.reason }));

  /* Decided statements are also evidence — the strongest kind. */
  const decidedEvidence: RuntimeEvidenceInput[] = decided.map((statement, index) => ({
    id: `decided:${index}`,
    statement,
    owningRoom: "core",
    tier: "decided",
    label: "Decided by a person",
  }));

  const packetEvidence: RuntimeEvidenceInput[] = (input.contextPacket?.statements ?? []).map(
    (statement, index) => ({
      id: `packet:${input.contextPacket?.id ?? "context"}:${index}`,
      statement,
      owningRoom: input.room,
      tier: "observed",
      ...(input.contextPacket ? { label: `Context packet — ${input.contextPacket.title}` } : {}),
    }),
  );

  const evidence = [...input.evidence, ...packetEvidence, ...decidedEvidence];

  const observations = input.observations ?? [];
  const patterns =
    observations.length > 0
      ? matchPatterns({
          observations,
          ...(input.canonDomains ? { domains: input.canonDomains } : {}),
          ...(input.suppressed ? { suppressed: input.suppressed } : {}),
          limit: 5,
        })
      : [];

  const cases = input.cases ?? [];
  const outcomes = input.outcomes ?? [];
  const priorExperience =
    patterns.length > 0 && cases.length > 0
      ? experienceForMatches({ matches: patterns, cases, outcomes })
      : {};

  /* Human corrections outrank everything the engine inferred. */
  const corrections = cases.filter((entry) => entry.outcome === "rejected");

  const capabilities = roomCapabilities(input.room);

  const knowledge: RetrievedKnowledgeRef[] = [
    ...patterns.map((match) => ({
      kind: "canon_pattern" as const,
      id: match.patternId,
      label: match.patternName,
      note: match.label,
    })),
    ...corrections.map((entry) => ({
      kind: "human_correction" as const,
      id: entry.id,
      label: `Corrected: ${entry.title}`,
    })),
    ...(input.contextPacket
      ? [
          {
            kind: "context_packet" as const,
            id: input.contextPacket.id,
            label: input.contextPacket.title,
          },
        ]
      : []),
  ];

  return {
    organizationId: input.organizationId,
    room: input.room,
    now: input.now,
    evidence,
    decided,
    withheld,
    patterns,
    priorExperience,
    corrections,
    capabilities,
    knowledge,
  };
}

/**
 * The packet the reasoning stage is allowed to see, serialized. Everything
 * the model may use is in here; nothing else reaches it.
 */
export function bundleForModel(bundle: RetrievalBundle): Record<string, unknown> {
  return {
    room: bundle.room,
    evidence: bundle.evidence.map((item) => ({
      ref: item.id,
      statement: item.statement,
      owningRoom: item.owningRoom,
      tier: item.tier,
      ...(item.label ? { label: item.label } : {}),
    })),
    decided: bundle.decided,
    withheld: bundle.withheld,
    knowledge: {
      patterns: bundle.patterns.map((match) => ({
        id: match.patternId,
        name: match.patternName,
        label: match.label,
      })),
      corrections: bundle.corrections.map((entry) => ({ id: entry.id, title: entry.title })),
    },
    capabilities: {
      executable: bundle.capabilities.executable.map((cap) => cap.operation),
      unavailable: bundle.capabilities.unavailable.map((cap) => ({
        operation: cap.operation,
        because: cap.unavailableReason ?? "not routable",
      })),
      externalSurfaces: bundle.capabilities.externalSurfaces,
      readOnly: bundle.capabilities.readOnly,
    },
  };
}

/** Every evidence id the read may legitimately cite. */
export function citableRefs(bundle: RetrievalBundle): Set<string> {
  return new Set(bundle.evidence.map((item) => item.id));
}
