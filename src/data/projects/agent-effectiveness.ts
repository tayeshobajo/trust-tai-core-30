/**
 * Agent effectiveness, projected as outcomes and evidence.
 *
 * Paperclip stays the source of truth for agent execution. This module only
 * says: here is what a person said good looks like, and here is what actually
 * happened. There is no productivity score, because a score would invent a
 * judgment nobody made.
 */

import type { AgentEffectiveness, AgentEvidence } from "@/domain/project-intelligence";

export type AccountabilityState =
  "on_track" | "behind" | "waiting" | "needs_a_person" | "not_defined";

export const ACCOUNTABILITY_LABEL: Record<AccountabilityState, string> = {
  on_track: "On track",
  behind: "Behind expected outcomes",
  waiting: "Waiting",
  needs_a_person: "Needs a person",
  not_defined: "No definition yet",
};

export interface AgentAccountability {
  agentId: string;
  state: AccountabilityState;
  because: string;
  expectedThisWeek: string[];
  outcome: string;
  evidence: string[];
  waitingReason?: string;
}

export function agentAccountability(
  definition: AgentEffectiveness | null,
  evidence: AgentEvidence,
  now: Date = new Date(),
): AgentAccountability {
  if (!definition) {
    return {
      agentId: "",
      state: "not_defined",
      because: "Nobody has said what this agent is responsible for yet.",
      expectedThisWeek: [],
      outcome: "No expected outcome on record.",
      evidence: [],
    };
  }

  const expected = definition.expectedWeeklyOutcomes;
  const lines: string[] = [
    `${evidence.completedOutcomes} of ${evidence.expectedOutcomes || expected.length} expected outcomes completed`,
  ];
  if (evidence.acceptedRecommendations || evidence.rejectedRecommendations)
    lines.push(
      `${evidence.acceptedRecommendations} recommendations accepted, ${evidence.rejectedRecommendations} rejected`,
    );
  if (evidence.correctionsRequired)
    lines.push(`${evidence.correctionsRequired} corrections required`);
  if (evidence.humanInterventions) lines.push(`${evidence.humanInterventions} human interventions`);
  if (evidence.failedAttempts) lines.push(`${evidence.failedAttempts} failed attempts`);
  for (const outcome of evidence.linkedOutcomes) lines.push(`Linked outcome: ${outcome}`);

  const target = evidence.expectedOutcomes || expected.length;
  const outcome =
    target === 0
      ? "No expected outcome on record."
      : `${evidence.completedOutcomes} of ${target} delivered.`;

  if (evidence.waitingSince) {
    const days = Math.max(
      0,
      Math.floor((now.getTime() - new Date(evidence.waitingSince).getTime()) / 86_400_000),
    );
    return {
      agentId: definition.agentId,
      state: "waiting",
      because: `Waiting ${days} day${days === 1 ? "" : "s"}${
        evidence.waitingReason ? `: ${evidence.waitingReason}` : "."
      }`,
      expectedThisWeek: expected,
      outcome,
      evidence: lines,
      ...(evidence.waitingReason ? { waitingReason: evidence.waitingReason } : {}),
    };
  }

  if (evidence.failedAttempts > 0 || evidence.humanInterventions > 0) {
    return {
      agentId: definition.agentId,
      state: "needs_a_person",
      because: "This agent could not finish without a person stepping in.",
      expectedThisWeek: expected,
      outcome,
      evidence: lines,
    };
  }

  if (target > 0 && evidence.completedOutcomes < target) {
    return {
      agentId: definition.agentId,
      state: "behind",
      because: `${target - evidence.completedOutcomes} expected outcome${
        target - evidence.completedOutcomes === 1 ? "" : "s"
      } not delivered yet.`,
      expectedThisWeek: expected,
      outcome,
      evidence: lines,
    };
  }

  return {
    agentId: definition.agentId,
    state: "on_track",
    because: "Every expected outcome has evidence behind it.",
    expectedThisWeek: expected,
    outcome,
    evidence: lines,
  };
}
