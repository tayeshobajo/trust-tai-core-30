/**
 * Studio evidence packet and output validation.
 *
 * Studio is model-backed but not model-trusted. Composition happens in two
 * steps, and this module owns both ends of it:
 *
 *   1. Build an explicit packet of approved truth. Only Decided strategy items
 *      and approved milestones are allowed in, each carrying its own sources.
 *      If the packet is not strong enough to argue from, the page says it is
 *      not ready instead of being written anyway.
 *
 *   2. Validate what came back. The model may improve expression, structure and
 *      visual direction. It may not introduce a fact. Any client-facing
 *      sentence that is not backed by the packet is rejected, and any source
 *      that was not in the packet is dropped rather than presented as proof.
 *
 * Pure and deterministic: no network, no model, no persistence.
 */

import type {
  ArtifactKind,
  ArtifactSection,
  ResearchClaim,
  RoadmapMilestone,
  RoadmapResearch,
  RoadmapStrategy,
  SourceRef,
  StrategyItem,
} from "@/domain/roadmap-intel";
import { buildOrder } from "./roadmap-milestones";

/* ------------------------------------------------------------------ packet */

export interface PacketFact {
  key: string;
  statement: string;
  because: string;
  sources: SourceRef[];
}

export interface PacketMilestone {
  id: string;
  sequence: number;
  name: string;
  whatWeBuild: string;
  intendedUser: string;
  clientAdvantage: string;
  currentGap: string;
  immediateValue: string;
  longTermValue: string;
  dependencies: string[];
  executionBoundary: string;
  sources: SourceRef[];
}

export interface EvidencePacket {
  subjectLabel: string;
  kind: ArtifactKind;
  /**
   * Sourced Observed research. A factual layer copy may lean on, never
   * direction. Nothing here is Decided, and nothing here can become Decided
   * by being written well.
   */
  observed: PacketFact[];
  /** When the public web was last read for this subject. */
  checkedAt?: string;
  centralTruth: PacketFact | null;
  pointA: PacketFact[];
  anchorProof: PacketFact[];
  gaps: PacketFact[];
  leveragePoint: PacketFact | null;
  pointB: PacketFact | null;
  pointC: PacketFact | null;
  milestones: PacketMilestone[];
  /** Every URL a composed section is allowed to cite. */
  allowedUrls: string[];
  /**
   * Every support key a composed paragraph may claim: approved fact keys,
   * observed fact keys and approved milestone ids. A client-facing paragraph
   * that cannot name one of these is not traceable, so it does not ship.
   */
  supportKeys: string[];
  /** Whether there is enough approved truth to argue from at all. */
  ready: boolean;
  /** What is missing, in plain language, when it is not ready. */
  missing: string[];
}

export interface PacketInput {
  subjectLabel: string;
  kind: ArtifactKind;
  strategy: RoadmapStrategy | null;
  milestones: RoadmapMilestone[];
  /** The latest completed research pass, when there is one. */
  research?: RoadmapResearch | null;
}

/**
 * Observed research, flattened into facts the model can cite by key.
 *
 * Only claims that carry a real source survive: an Observed tier without a
 * receipt is a deduction wearing a fact's clothes, and Studio does not let
 * that reach a client page.
 */
function observedFacts(research: RoadmapResearch | null | undefined): PacketFact[] {
  if (!research || research.status !== "complete") return [];

  const groups: [string, ResearchClaim[]][] = [
    ["company model", research.companyModel],
    ["buyers", research.buyers],
    ["strengths", research.strengths],
    ["digital presence", research.digitalPresence],
    ["market direction", research.marketDirection],
  ];

  const facts: PacketFact[] = [];
  const add = (statement: string, because: string, sources: SourceRef[]) => {
    facts.push({ key: `research:fact:${facts.length + 1}`, statement, because, sources });
  };

  for (const [group, claims] of groups) {
    for (const claim of claims) {
      if (claim.tier !== "observed" || claim.sources.length === 0) continue;
      add(
        claim.statement,
        `Observed research, ${group}, ${claim.confidence} confidence.`,
        claim.sources,
      );
    }
  }

  for (const competitor of research.competitors) {
    if (competitor.tier !== "observed" || competitor.sources.length === 0) continue;
    add(
      `${competitor.name}: ${competitor.positioning}`,
      "Observed research, competitors.",
      competitor.sources,
    );
  }

  return facts;
}

function isApprovedItem(item: StrategyItem | null | undefined): boolean {
  return Boolean(item && item.approval === "approved" && item.tier === "decided");
}

/**
 * Support keys are namespaced so a client sentence can be walked back to the
 * exact kind of truth behind it: approved strategy, observed research, or an
 * approved milestone. A bare item key would be ambiguous across roadmaps.
 */
function toFact(item: StrategyItem, group: string): PacketFact {
  return {
    key: `strategy:${group}:${item.key}`,
    statement: item.statement,
    because: item.because,
    sources: item.sources,
  };
}

function approvedFacts(items: StrategyItem[], group: string): PacketFact[] {
  return items.filter(isApprovedItem).map((item) => toFact(item, group));
}

function approvedFact(item: StrategyItem | null | undefined, group: string): PacketFact | null {
  return isApprovedItem(item) ? toFact(item as StrategyItem, group) : null;
}

/**
 * The approved-truth packet. Nothing that a person has not approved reaches
 * the model, so the model cannot express something the room has not decided.
 */
export function buildEvidencePacket(input: PacketInput): EvidencePacket {
  const strategy = input.strategy;
  const observed = observedFacts(input.research);
  const pointA = approvedFacts(strategy?.pointA ?? [], "point_a");
  const anchorProof = approvedFacts(strategy?.anchorProof ?? [], "anchor");
  const gaps = approvedFacts(strategy?.gaps ?? [], "gap");
  const centralTruth = approvedFact(strategy?.centralTruth, "central_truth");
  const leveragePoint = approvedFact(strategy?.leveragePoint, "leverage");
  const pointB = approvedFact(strategy?.pointB, "point_b");
  const pointC = approvedFact(strategy?.pointC, "point_c");

  const milestones: PacketMilestone[] =
    input.kind === "full"
      ? buildOrder(input.milestones).map((milestone, index) => ({
          id: milestone.id,
          sequence: index + 1,
          name: milestone.name,
          whatWeBuild: milestone.whatWeBuild,
          intendedUser: milestone.intendedUser,
          clientAdvantage: milestone.clientAdvantage,
          currentGap: milestone.currentGap,
          immediateValue: milestone.immediateValue,
          longTermValue: milestone.longTermValue,
          dependencies: milestone.dependencies,
          executionBoundary: milestone.executionBoundary,
          sources: milestone.evidence,
        }))
      : [];

  const allowed = new Set<string>();
  for (const fact of [
    ...pointA,
    ...anchorProof,
    ...gaps,
    ...(centralTruth ? [centralTruth] : []),
    ...(leveragePoint ? [leveragePoint] : []),
    ...(pointB ? [pointB] : []),
    ...(pointC ? [pointC] : []),
  ]) {
    for (const ref of fact.sources) allowed.add(ref.url);
  }
  for (const milestone of milestones) {
    for (const ref of milestone.sources) allowed.add(ref.url);
  }
  for (const fact of observed) {
    for (const ref of fact.sources) allowed.add(ref.url);
  }

  const supportKeys = [
    ...[
      ...pointA,
      ...anchorProof,
      ...gaps,
      ...(centralTruth ? [centralTruth] : []),
      ...(leveragePoint ? [leveragePoint] : []),
      ...(pointB ? [pointB] : []),
      ...(pointC ? [pointC] : []),
      ...observed,
    ].map((fact) => fact.key),
    ...milestones.map((milestone) => `milestone:${milestone.id}`),
  ];

  const missing: string[] = [];
  if (pointA.length === 0) missing.push("Point A has not been approved.");
  if (anchorProof.length === 0) missing.push("No anchor proof has been approved.");
  if (gaps.length === 0) missing.push("No market gap has been approved.");
  if (!pointB) missing.push("Point B has not been approved.");
  if (input.kind === "full" && milestones.length === 0) {
    missing.push("No milestone has been approved, so there is nothing to sequence.");
  }

  return {
    subjectLabel: input.subjectLabel,
    kind: input.kind,
    observed,
    ...(input.research?.checkedAt ? { checkedAt: input.research.checkedAt } : {}),
    centralTruth,
    pointA,
    anchorProof,
    gaps,
    leveragePoint,
    pointB,
    pointC,
    milestones,
    allowedUrls: [...allowed],
    supportKeys,
    ready: missing.length === 0,
    missing,
  };
}

/** The pages the model is asked to write, in order, for this packet. */
export function packetOutline(
  packet: EvidencePacket,
): { key: string; title: string; brief: string }[] {
  const pages = [
    {
      key: "title",
      title: "Title page",
      brief:
        "One conviction-led line for this company, drawn from the approved central truth or Point B. No tagline language.",
    },
    {
      key: "point-a",
      title: "Point A: current position",
      brief:
        "Interpret the approved Point A statements for what they mean commercially. Do not simply repeat them.",
    },
    {
      key: "market-gap",
      title: "The market gap",
      brief:
        "The approved gaps, and the approved leverage point if one exists, written as one clear argument.",
    },
    {
      key: "note-from-tai",
      title: "A note from Tai",
      brief:
        "Warm, direct, first person. Recognise the approved anchor proof, then state the approved Point B as the next move.",
    },
  ];

  if (packet.kind !== "full") return pages;

  for (const milestone of packet.milestones) {
    pages.push({
      key: `milestone-${milestone.id}`,
      title: `${milestone.sequence}. ${milestone.name}`,
      brief:
        "One page for this milestone: what gets built, who it is for, the gap it closes, its execution boundary, and What It Unlocks now and later.",
    });
  }

  pages.push({
    key: "closing",
    title: "Where this compounds",
    brief:
      "Close on the approved Point C if one exists, otherwise on the approved Point B. One page, one thought.",
  });

  return pages;
}

/* -------------------------------------------------------------- validation */

/** Language that could belong to any company. It never ships. */
const GENERIC = [
  "best-in-class",
  "world-class",
  "cutting-edge",
  "industry-leading",
  "game-changing",
  "next level",
  "holistic",
  "synergy",
  "synergies",
  "turnkey",
  "best practices",
  "unlock your potential",
  "fast-paced world",
  "in today's",
  "seamless experience",
  "leverage our",
  "trusted partner for all",
];

const NUMERIC = /\b\d[\d,.]*\s?(%|percent|k|m|bn|billion|million|x)?\b|[$£€]\s?\d/gi;

function normalizeVoice(text: string): string {
  // No em dashes, ever. They are the tell of generated copy.
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function packetCorpus(packet: EvidencePacket): string {
  const parts: string[] = [packet.subjectLabel];
  for (const fact of [
    ...packet.pointA,
    ...packet.anchorProof,
    ...packet.gaps,
    ...(packet.centralTruth ? [packet.centralTruth] : []),
    ...(packet.leveragePoint ? [packet.leveragePoint] : []),
    ...(packet.pointB ? [packet.pointB] : []),
    ...(packet.pointC ? [packet.pointC] : []),
    ...packet.observed,
  ]) {
    parts.push(fact.statement, fact.because);
  }
  for (const milestone of packet.milestones) {
    parts.push(
      milestone.name,
      milestone.whatWeBuild,
      milestone.intendedUser,
      milestone.clientAdvantage,
      milestone.currentGap,
      milestone.immediateValue,
      milestone.longTermValue,
      milestone.executionBoundary,
      ...milestone.dependencies,
    );
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Why a line was refused.
 *
 * "voice" is a writing problem: the sentence is interchangeable, so it is
 * dropped and the rest of the page still stands. "fabrication" is a truth
 * problem: a figure or a source the approved packet never contained. A
 * fabrication is not an edit, it means the composition cannot be trusted, so
 * the caller refuses the whole run rather than saving a corrected version of
 * a document that invented something.
 */
export type RejectionSeverity = "voice" | "fabrication" | "unsupported";

export interface RejectedLine {
  section: string;
  line: string;
  reason: string;
  severity: RejectionSeverity;
}

export interface ValidationResult {
  sections: ArtifactSection[];
  /** Every line that was refused, and why, so the room can see the edit. */
  rejected: RejectedLine[];
}

/** True when the model asserted something the approved packet cannot back. */
export function hasFabrication(rejected: RejectedLine[]): boolean {
  return rejected.some((entry) => entry.severity === "fabrication");
}

/** What the room needs to see before pressing compose. */
export interface PacketSummary {
  ready: boolean;
  missing: string[];
  approvedStrategyCount: number;
  approvedMilestoneCount: number;
  observedFactCount: number;
  sourceCount: number;
  checkedAt?: string;
}

export function packetSummary(packet: EvidencePacket): PacketSummary {
  const strategy =
    packet.pointA.length +
    packet.anchorProof.length +
    packet.gaps.length +
    (packet.centralTruth ? 1 : 0) +
    (packet.leveragePoint ? 1 : 0) +
    (packet.pointB ? 1 : 0) +
    (packet.pointC ? 1 : 0);

  return {
    ready: packet.ready,
    missing: packet.missing,
    approvedStrategyCount: strategy,
    approvedMilestoneCount: packet.milestones.length,
    observedFactCount: packet.observed.length,
    sourceCount: packet.allowedUrls.length,
    ...(packet.checkedAt ? { checkedAt: packet.checkedAt } : {}),
  };
}

/**
 * Every packet fact and milestone, indexed by the support key that names it.
 * Studio's evidence disclosure reads this so a reader can see the fact behind
 * a page rather than only the count of them.
 */
export function packetFactIndex(packet: EvidencePacket): Map<string, PacketFact> {
  const index = new Map<string, PacketFact>();
  for (const fact of [
    ...packet.pointA,
    ...packet.anchorProof,
    ...packet.gaps,
    ...packet.observed,
    ...(packet.centralTruth ? [packet.centralTruth] : []),
    ...(packet.leveragePoint ? [packet.leveragePoint] : []),
    ...(packet.pointB ? [packet.pointB] : []),
    ...(packet.pointC ? [packet.pointC] : []),
  ]) {
    index.set(fact.key, fact);
  }
  for (const milestone of packet.milestones) {
    index.set(`milestone:${milestone.id}`, {
      key: `milestone:${milestone.id}`,
      statement: `${milestone.sequence}. ${milestone.name}`,
      because: milestone.whatWeBuild,
      sources: milestone.sources,
    });
  }
  return index;
}

export const NOT_READY_LINE = "Not ready. The approved evidence does not support this page yet.";

/**
 * Validate a composed document against the packet it was written from.
 *
 * A line survives only if it invents no figure the packet does not contain and
 * uses no interchangeable consulting language. A source survives only if the
 * packet cited it. A page keeps the Decided tier only if it still stands on
 * approved evidence after that edit.
 */
export function validateSections(
  sections: ArtifactSection[],
  packet: EvidencePacket,
): ValidationResult {
  const corpus = packetCorpus(packet);
  const allowed = new Set(packet.allowedUrls);
  const known = new Set(packet.supportKeys);
  const rejected: ValidationResult["rejected"] = [];

  const clean = sections.map((section) => {
    const stated = new Map<string, string[]>();
    for (const entry of section.support ?? []) {
      stated.set(normalizeVoice(entry.line), entry.keys);
    }

    const body: string[] = [];
    const support: { line: string; keys: string[] }[] = [];

    for (const raw of section.body) {
      const line = normalizeVoice(raw);
      if (!line) continue;

      const generic = GENERIC.find((phrase) => line.toLowerCase().includes(phrase));
      if (generic) {
        rejected.push({
          section: section.key,
          line,
          reason: `Interchangeable language: "${generic}".`,
          severity: "voice",
        });
        continue;
      }

      const numbers = line.match(NUMERIC) ?? [];
      const invented = numbers.find((token) => !corpus.includes(token.toLowerCase().trim()));
      if (invented) {
        rejected.push({
          section: section.key,
          line,
          reason: `Figure "${invented.trim()}" is not in the approved evidence.`,
          severity: "fabrication",
        });
        continue;
      }

      /**
       * Traceability, not semantic guessing. A paragraph survives only when it
       * names at least one real key from this packet. A claim nobody can walk
       * back to approved or observed evidence is not a claim we put in front of
       * a client, however well it reads.
       */
      const keys = (stated.get(line) ?? []).filter((key) => known.has(key));
      if (keys.length === 0) {
        rejected.push({
          section: section.key,
          line,
          reason: "No approved or observed evidence was cited for this claim.",
          severity: "unsupported",
        });
        continue;
      }

      body.push(line);
      support.push({ line, keys: [...new Set(keys)] });
    }

    const sources = section.sources.filter((ref) => allowed.has(ref.url));
    for (const ref of section.sources) {
      if (!allowed.has(ref.url)) {
        rejected.push({
          section: section.key,
          line: ref.url,
          reason: "Source was not in the approved evidence packet.",
          severity: "fabrication",
        });
      }
    }

    /**
     * "What it unlocks" is a client facing claim like any other, so it obeys
     * the same rule: name the evidence or do not ship the line.
     */
    const unlocks: string[] = [];
    for (const raw of section.unlocks ?? []) {
      const line = normalizeVoice(raw);
      if (!line) continue;
      const keys = (stated.get(line) ?? []).filter((key) => known.has(key));
      if (keys.length === 0) {
        rejected.push({
          section: section.key,
          line,
          reason: "No approved or observed evidence was cited for this claim.",
          severity: "unsupported",
        });
        continue;
      }
      unlocks.push(line);
      support.push({ line, keys: [...new Set(keys)] });
    }

    const empty = body.length === 0;
    const supportKeys = [...new Set(support.flatMap((entry) => entry.keys))];

    return {
      key: section.key,
      title: normalizeVoice(section.title),
      body: empty ? [NOT_READY_LINE] : body,
      tier: empty || sources.length === 0 ? ("inferred" as const) : ("decided" as const),
      sources,
      ...(section.visualDirection
        ? { visualDirection: normalizeVoice(section.visualDirection) }
        : {}),
      ...(section.caption ? { caption: normalizeVoice(section.caption) } : {}),
      ...(unlocks.length > 0 ? { unlocks } : {}),
      ...(support.length > 0 ? { support, supportKeys } : {}),
    } satisfies ArtifactSection;
  });

  return { sections: clean.filter((section) => section.title.length > 0), rejected };
}
