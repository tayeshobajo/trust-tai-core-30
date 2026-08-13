/**
 * Studio composition.
 *
 * Turns approved strategy plus approved milestones into a client-facing
 * document structure. Pure and deterministic: there is no model here, so there
 * is nothing to hallucinate.
 *
 * Hard rules:
 *  - Only Decided strategy items become client-facing statements.
 *  - Anything not approved appears as Unknown, never as a confident sentence.
 *  - No figures, timelines, budgets, internal access, client preferences, or
 *    promised outcomes are ever composed here.
 */

import type {
  ArtifactSection,
  RoadmapMilestone,
  RoadmapStrategy,
  SourceRef,
  StrategyItem,
} from "@/domain/roadmap-intel";
import { UNKNOWN } from "@/domain/roadmap-intel";
import { buildOrder } from "./roadmap-milestones";

export interface StudioInput {
  subjectLabel: string;
  strategy: RoadmapStrategy | null;
  milestones: RoadmapMilestone[];
  /** Only ever a colour already validated from the client's own site. */
  accent?: string | undefined;
  logoUrl?: string | undefined;
}

function approved(item: StrategyItem | null | undefined): StrategyItem | null {
  return item && item.approval === "approved" ? item : null;
}

function approvedList(items: StrategyItem[]): StrategyItem[] {
  return items.filter((item) => item.approval === "approved");
}

function sourcesOf(items: (StrategyItem | null)[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const item of items) {
    if (!item) continue;
    for (const ref of item.sources) if (!seen.has(ref.url)) seen.set(ref.url, ref);
  }
  return [...seen.values()];
}

/** Title Page, Point A, Market Gap, Note from Tai. */
export function composePreview(input: StudioInput): ArtifactSection[] {
  const strategy = input.strategy;
  const pointA = strategy ? approvedList(strategy.pointA) : [];
  const gaps = strategy ? approvedList(strategy.gaps) : [];
  const anchor = strategy ? approvedList(strategy.anchorProof) : [];
  const pointB = approved(strategy?.pointB);
  const leverage = approved(strategy?.leveragePoint);
  const truth = approved(strategy?.centralTruth);

  const sections: ArtifactSection[] = [];

  sections.push({
    key: "title",
    title: input.subjectLabel,
    body: [
      truth ? truth.statement : UNKNOWN,
      "A researched point of view on where this business goes next.",
    ],
    tier: truth ? "decided" : "inferred",
    sources: sourcesOf([truth]),
    visualDirection:
      "Full-bleed quiet cover. Company name set large, one line of context beneath it, generous margins.",
    caption: "Prepared by Trust Tai",
  });

  sections.push({
    key: "point-a",
    title: "Where the business is today",
    body:
      pointA.length > 0
        ? pointA.map((item) => item.statement)
        : [`${UNKNOWN}. Point A has not been approved yet, so nothing is stated here.`],
    tier: pointA.length > 0 ? "decided" : "inferred",
    sources: sourcesOf(pointA),
    visualDirection: "Single column of short observed statements, each with its source beneath.",
  });

  sections.push({
    key: "market-gap",
    title: "The gap in the market",
    body:
      gaps.length > 0
        ? [
            ...gaps.map((item) => item.statement),
            ...(leverage ? [`The leverage point: ${leverage.statement}`] : []),
          ]
        : [`${UNKNOWN}. No market gap has been approved yet.`],
    tier: gaps.length > 0 ? "decided" : "inferred",
    sources: sourcesOf([...gaps, leverage]),
    visualDirection: "Two-part page: the gap on the left, the leverage point pulled out on the right.",
  });

  sections.push({
    key: "note-from-tai",
    title: "A note from Tai",
    body: [
      anchor.length > 0
        ? `You have already built something real here. ${anchor.map((item) => item.statement).join(" ")}`
        : `${UNKNOWN}. No anchor proof has been approved, so this note stays unwritten.`,
      pointB
        ? `The next move is to build on that: ${pointB.statement}`
        : "Where this goes next is still open, and that is the conversation.",
      "Trust, Tai",
    ],
    tier: anchor.length > 0 && pointB ? "decided" : "inferred",
    sources: sourcesOf([...anchor, pointB]),
    visualDirection: "Letter page. Narrow measure, signature set quietly at the foot.",
  });

  return sections;
}

/** Preview sections plus one page per approved milestone. */
export function composeFull(input: StudioInput): ArtifactSection[] {
  const strategy = input.strategy;
  const pointC = approved(strategy?.pointC);
  const sections = composePreview(input);
  const ordered = buildOrder(input.milestones);

  if (ordered.length === 0) {
    sections.push({
      key: "build-order-empty",
      title: "The build order",
      body: [`${UNKNOWN}. No milestone has been approved, so there is nothing to sequence yet.`],
      tier: "inferred",
      sources: [],
    });
    return sections;
  }

  ordered.forEach((milestone, index) => {
    sections.push({
      key: `milestone-${milestone.id}`,
      title: `${index + 1}. ${milestone.name}`,
      body: [
        milestone.whatWeBuild,
        `Built for ${milestone.intendedUser || UNKNOWN}.`,
        milestone.currentGap ? `It closes this gap: ${milestone.currentGap}` : UNKNOWN,
        milestone.executionBoundary
          ? `Boundary: ${milestone.executionBoundary}`
          : `Boundary: ${UNKNOWN}`,
      ],
      tier: "decided",
      sources: milestone.evidence,
      unlocks: [
        milestone.immediateValue || UNKNOWN,
        milestone.longTermValue || UNKNOWN,
      ],
      visualDirection:
        "One page per milestone. Name, what gets built, then What It Unlocks as two short lines.",
      ...(milestone.clientAdvantage ? { caption: milestone.clientAdvantage } : {}),
    });
  });

  sections.push({
    key: "point-c",
    title: "Where this compounds",
    body: [pointC ? pointC.statement : `${UNKNOWN}. The long horizon has not been approved yet.`],
    tier: pointC ? "decided" : "inferred",
    sources: sourcesOf([pointC]),
    visualDirection: "Closing page. One statement, nothing else on the page.",
  });

  return sections;
}
