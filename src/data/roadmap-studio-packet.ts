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
  RoadmapMilestone,
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
}

function isApprovedItem(item: StrategyItem | null | undefined): boolean {
  return Boolean(item && item.approval === "approved" && item.tier === "decided");
}

function toFact(item: StrategyItem): PacketFact {
  return {
    key: item.key,
    statement: item.statement,
    because: item.because,
    sources: item.sources,
  };
}

function approvedFacts(items: StrategyItem[]): PacketFact[] {
  return items.filter(isApprovedItem).map(toFact);
}

function approvedFact(item: StrategyItem | null | undefined): PacketFact | null {
  return isApprovedItem(item) ? toFact(item as StrategyItem) : null;
}

/**
 * The approved-truth packet. Nothing that a person has not approved reaches
 * the model, so the model cannot express something the room has not decided.
 */
export function buildEvidencePacket(input: PacketInput): EvidencePacket {
  const strategy = input.strategy;
  const pointA = approvedFacts(strategy?.pointA ?? []);
  const anchorProof = approvedFacts(strategy?.anchorProof ?? []);
  const gaps = approvedFacts(strategy?.gaps ?? []);
  const centralTruth = approvedFact(strategy?.centralTruth);
  const leveragePoint = approvedFact(strategy?.leveragePoint);
  const pointB = approvedFact(strategy?.pointB);
  const pointC = approvedFact(strategy?.pointC);

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
    centralTruth,
    pointA,
    anchorProof,
    gaps,
    leveragePoint,
    pointB,
    pointC,
    milestones,
    allowedUrls: [...allowed],
    ready: missing.length === 0,
    missing,
  };
}

/** The pages the model is asked to write, in order, for this packet. */
export function packetOutline(packet: EvidencePacket): { key: string; title: string; brief: string }[] {
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
  return text.replace(/\s*[—–]\s*/g, ", ").replace(/\s{2,}/g, " ").trim();
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

export interface ValidationResult {
  sections: ArtifactSection[];
  /** Every line that was refused, and why, so the room can see the edit. */
  rejected: { section: string; line: string; reason: string }[];
}

export const NOT_READY_LINE =
  "Not ready. The approved evidence does not support this page yet.";

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
  const rejected: ValidationResult["rejected"] = [];

  const clean = sections.map((section) => {
    const body: string[] = [];
    for (const raw of section.body) {
      const line = normalizeVoice(raw);
      if (!line) continue;

      const generic = GENERIC.find((phrase) => line.toLowerCase().includes(phrase));
      if (generic) {
        rejected.push({
          section: section.key,
          line,
          reason: `Interchangeable language: "${generic}".`,
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
        });
        continue;
      }

      body.push(line);
    }

    const sources = section.sources.filter((ref) => allowed.has(ref.url));
    for (const ref of section.sources) {
      if (!allowed.has(ref.url)) {
        rejected.push({
          section: section.key,
          line: ref.url,
          reason: "Source was not in the approved evidence packet.",
        });
      }
    }

    const unlocks = (section.unlocks ?? []).map(normalizeVoice).filter(Boolean);
    const empty = body.length === 0;

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
    } satisfies ArtifactSection;
  });

  return { sections: clean.filter((section) => section.title.length > 0), rejected };
}
