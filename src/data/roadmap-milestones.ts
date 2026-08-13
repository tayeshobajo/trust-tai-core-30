/**
 * Milestone ranking.
 *
 * Deterministic and pure. The model proposes candidates; this file decides how
 * they are ordered, and it can always say why in plain sentences. No model call
 * happens here, so the ranking cannot drift between two identical roadmaps.
 *
 * Ranking is a recommendation. It never changes a milestone's status: only a
 * person moves a candidate to approved, rejected, or deferred.
 */

import type { ConfidenceLevel } from "@/domain/confidence";
import type { RoadmapMilestone, SourceRef } from "@/domain/roadmap-intel";

export interface MilestoneScoreInput {
  name: string;
  evidence: SourceRef[];
  supportingMarketDirection: string;
  clientAdvantage: string;
  currentGap: string;
  immediateValue: string;
  longTermValue: string;
  dependencies: string[];
  executionBoundary: string;
  confidence: ConfidenceLevel;
}

export interface MilestoneScore {
  priorityScore: number;
  priorityRationale: string[];
}

/** Confidence can lower a score, never raise it past its evidence. */
const CONFIDENCE_CAP: Record<ConfidenceLevel, number> = {
  high: 100,
  moderate: 80,
  low: 60,
  unknown: 40,
};

function filled(value: string): boolean {
  return value.trim().length > 0;
}

export function scoreMilestone(input: MilestoneScoreInput): MilestoneScore {
  const rationale: string[] = [];
  let score = 0;

  const sourced = input.evidence.filter((ref) => ref.url.trim().length > 0).length;
  const evidencePoints = Math.round((Math.min(sourced, 3) / 3) * 25);
  score += evidencePoints;
  rationale.push(
    sourced === 0
      ? "No sourced evidence is attached, so this cannot rank above a proposal."
      : `${sourced} sourced ${sourced === 1 ? "reference" : "references"} support this.`,
  );

  if (filled(input.supportingMarketDirection)) {
    score += 20;
    rationale.push("Market direction on record points the same way.");
  } else {
    rationale.push("No market direction is recorded for this milestone.");
  }

  if (filled(input.clientAdvantage)) {
    score += 15;
    rationale.push("It uses an advantage the company already has.");
  }

  if (filled(input.currentGap)) {
    score += 15;
    rationale.push("It closes a gap that is written down, not assumed.");
  }

  if (filled(input.immediateValue)) {
    score += 10;
    rationale.push("There is value inside the first move, not only later.");
  }

  if (filled(input.longTermValue)) {
    score += 10;
    rationale.push("The value compounds after it ships.");
  }

  if (filled(input.executionBoundary)) {
    score += 5;
    rationale.push("The execution boundary is stated, so scope is honest.");
  } else {
    rationale.push("No execution boundary is stated yet.");
  }

  const deps = input.dependencies.filter((entry) => filled(entry)).length;
  if (deps > 0) {
    const penalty = Math.min(deps * 5, 15);
    score -= penalty;
    rationale.push(
      `${deps} ${deps === 1 ? "dependency has" : "dependencies have"} to clear first.`,
    );
  }

  const cap = CONFIDENCE_CAP[input.confidence];
  const bounded = Math.max(0, Math.min(100, score));
  if (bounded > cap) {
    rationale.push(`Held at ${cap} because confidence is ${input.confidence}.`);
  }

  return { priorityScore: Math.min(bounded, cap), priorityRationale: rationale };
}

export type Ranked<T> = T & MilestoneScore & { recommendedSequence: number };

/** Score every candidate, then order them. Ties break on fewer dependencies. */
export function rankMilestones<T extends MilestoneScoreInput>(candidates: T[]): Ranked<T>[] {
  return candidates
    .map((candidate, index) => ({ ...candidate, ...scoreMilestone(candidate), index }))
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      const depDiff = a.dependencies.length - b.dependencies.length;
      if (depDiff !== 0) return depDiff;
      return a.index - b.index;
    })
    .map(({ index: _index, ...rest }, position) => ({
      ...(rest as T & MilestoneScore),
      recommendedSequence: position + 1,
    }));
}

/**
 * Build Order. Approved and Decided only, in the sequence a person can act on.
 * A shortlisted or deferred milestone is deliberately invisible here.
 */
export function buildOrder(milestones: RoadmapMilestone[]): RoadmapMilestone[] {
  return milestones
    .filter((milestone) => milestone.status === "approved" && milestone.tier === "decided")
    .sort(
      (a, b) =>
        a.recommendedSequence - b.recommendedSequence ||
        b.priorityScore - a.priorityScore ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** Whether a milestone can be prepared for Projects, and why not when it cannot. */
export function readiness(milestone: RoadmapMilestone): { ready: boolean; because: string } {
  if (milestone.status !== "approved") {
    return { ready: false, because: "Not approved by a person yet." };
  }
  if (milestone.tier !== "decided") {
    return { ready: false, because: "Still recorded as a proposal, not a decision." };
  }
  const open = milestone.dependencies.filter((entry) => entry.trim().length > 0);
  if (open.length > 0) {
    return {
      ready: false,
      because: `${open.length} ${open.length === 1 ? "dependency is" : "dependencies are"} still open.`,
    };
  }
  if (!milestone.ownerUserId && !milestone.ownerLabel) {
    return { ready: false, because: "No one is named as carrying it." };
  }
  return { ready: true, because: "Approved, unblocked, and owned." };
}
