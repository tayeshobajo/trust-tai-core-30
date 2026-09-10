/**
 * Which milestone deserves attention next — Roadmap's own reading.
 *
 * Roadmap owns its sequence, so it owns the question of where attention sits
 * in that sequence. Conductor and every other surface project this result; no
 * room computes a second, differently ordered opinion over the same stages.
 *
 * Deterministic governance, not interpretation: written rules over recorded
 * Roadmap state, no model judgment, no invented dependency.
 */

import type { RoadmapDecision, Tier } from "@/domain/roadmap";
import type { CanonMilestone, MilestoneAttention } from "@/domain/conductor";

const STATE_RANK: Record<string, number> = { blocked: 0, in_build: 1, mapped: 2, live: 3 };
const TIER_RANK: Record<Tier, number> = { decided: 0, observed: 1, inferred: 2 };

const DESTINATION_PATTERNS: RegExp[] = [
  /\bdestination\b/i,
  /\bpoint b\b/i,
  /\bagree(ment|d)?\b/i,
  /\bobjective\b/i,
];

function looksLikeDestinationWork(milestone: CanonMilestone): boolean {
  const text = `${milestone.title} ${milestone.intent ?? ""}`;
  return DESTINATION_PATTERNS.some((pattern) => pattern.test(text));
}

function unfinished(milestone: CanonMilestone): boolean {
  return milestone.state !== "live";
}

function bySequence(a: CanonMilestone, b: CanonMilestone): number {
  return (
    a.position - b.position ||
    (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9) ||
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    Number(Boolean(b.ownerLabel ?? b.ownerUserId)) -
      Number(Boolean(a.ownerLabel ?? a.ownerUserId)) ||
    a.id.localeCompare(b.id)
  );
}

export function milestoneAttentionOf(input: {
  milestones: CanonMilestone[];
  openDecisions: RoadmapDecision[];
  pointB: { tier: "inferred" | "decided" } | null;
}): MilestoneAttention | null {
  const open = [...input.milestones].filter(unfinished).sort(bySequence);
  if (open.length === 0) return null;

  /* 1. An unresolved human decision sitting on a milestone outranks sequence. */
  for (const milestone of open) {
    const decision = input.openDecisions.find((row) => row.stageId === milestone.id);
    if (decision) {
      return {
        milestone,
        rule: "open_decision",
        because: `An unresolved decision sits on this milestone: "${decision.question}". Only you can answer it.`,
        decisionId: decision.id,
      };
    }
  }

  /* 2. An undecided destination comes before anything sequenced after it. */
  if (input.pointB?.tier !== "decided" && input.openDecisions.length > 0) {
    const destination = open.find(looksLikeDestinationWork);
    if (destination) {
      return {
        milestone: destination,
        rule: "destination_first",
        because:
          "Point B is not decided yet, and the milestones after this one assume the answer. That is sequence logic, not a recorded dependency.",
        ...(input.openDecisions[0] ? { decisionId: input.openDecisions[0].id } : {}),
      };
    }
  }

  /* 3. Earliest unfinished milestone in the recorded sequence. */
  const first = open[0]!;
  return {
    milestone: first,
    rule: "sequence_position",
    because: `Earliest unfinished milestone in the recorded sequence (position ${first.position}, ${first.state.replace(/_/g, " ")}, ${first.tier}). No dependency is recorded against it.`,
  };
}
