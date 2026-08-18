/**
 * Observed evidence for one agent, read from what Paperclip actually reported.
 *
 * Nothing is inferred beyond counting. If Paperclip has not reported it, it is
 * not here, and the accountability view says so rather than guessing.
 */

import {
  EMPTY_AGENT_EVIDENCE,
  type AgentEffectiveness,
  type AgentEvidence,
} from "@/domain/project-intelligence";
import type { StewardAgent } from "@/domain/steward-accountability";

export function agentEvidenceFrom(
  agent: StewardAgent,
  definition: AgentEffectiveness | null,
): AgentEvidence {
  const expected = definition?.expectedWeeklyOutcomes.length ?? 0;
  const waitingTask = agent.awaitingApproval[0] ?? null;

  return {
    ...EMPTY_AGENT_EVIDENCE,
    expectedOutcomes: expected,
    completedOutcomes: agent.completedThisWeek ?? 0,
    humanInterventions: agent.isPaused ? 1 : 0,
    linkedOutcomes: agent.recentOutcome ? [agent.recentOutcome] : [],
    ...(waitingTask
      ? {
          waitingSince: agent.lastHeartbeatAt ?? new Date().toISOString(),
          waitingReason: `Waiting for a person to approve “${waitingTask.title}”.`,
        }
      : {}),
  };
}

/** Which of the required context items this agent has not been given. */
export function missingContext(
  definition: AgentEffectiveness | null,
  agent: StewardAgent,
): string[] {
  if (!definition) return [];
  const published = new Set(agent.capabilities.map((entry) => entry.toLowerCase()));
  return definition.requiredContext.filter((entry) => !published.has(entry.toLowerCase()));
}
