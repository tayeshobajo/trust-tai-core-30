/**
 * One read for every Steward accountability surface.
 *
 * Team, Tasks and Agents all answer the same question from the same rows, so
 * they share one query. Nothing here invents a value: every source that is
 * unavailable simply contributes nothing, and the surface says so.
 */

import { projectDelivery } from "@/data/supabase/project-delivery";
import { projectsService } from "@/data/supabase/projects-service";
import { stewardService, type StoredConversation } from "@/data/supabase/steward-service";
import { stewardTaskState } from "@/data/supabase/steward-task-state";
import { getStewardAgents } from "@/data/steward-agents.functions";
import type { Commitment } from "@/domain/steward";
import type { StewardAgentRead, StewardTask } from "@/domain/steward-accountability";

import { buildStewardTasks } from "./accountability";

export interface StewardTeamRead {
  now: string;
  tasks: StewardTask[];
  commitments: Commitment[];
  conversations: StoredConversation[];
  agents: StewardAgentRead;
  /** True when Steward may persist focus and ordering. */
  stateProvisioned: boolean;
}

const NO_AGENTS: StewardAgentRead = {
  agents: [],
  connected: false,
  because: "Paperclip is not reachable from this workspace right now.",
};

export async function readStewardTeam(organizationId: string): Promise<StewardTeamRead> {
  const now = new Date().toISOString();

  const [commitments, conversations, projects, workItems, taskState, stateProvisioned, agents] =
    await Promise.all([
      stewardService.commitments(organizationId),
      stewardService.conversations(organizationId, 12).catch(() => []),
      projectsService.list(organizationId).catch(() => []),
      projectDelivery.listOrgWork(organizationId).catch(() => []),
      stewardTaskState.list(organizationId).catch(() => []),
      stewardTaskState.provisioned(organizationId).catch(() => false),
      getStewardAgents({ data: { organizationId } }).catch(
        (error: unknown): StewardAgentRead => ({
          ...NO_AGENTS,
          because:
            error instanceof Error
              ? `Paperclip could not be read. ${error.message}`
              : NO_AGENTS.because,
        }),
      ),
    ]);

  return {
    now,
    commitments,
    conversations,
    agents,
    stateProvisioned,
    tasks: buildStewardTasks({
      now,
      commitments,
      workItems,
      projects,
      agents: agents.agents,
      taskState,
    }),
  };
}

/** Fathom's real sync state, expressed only from rows Steward actually has. */
export function fathomStatusLine(read: StewardTeamRead | undefined): string | null {
  if (!read) return null;
  const latest = read.conversations
    .filter((row) => row.provider === "fathom")
    .map((row) => row.occurredAt)
    .sort()
    .pop();
  const agentCount = read.agents.agents.length;
  const parts: string[] = [];
  parts.push(latest ? `Fathom synced ${latest.slice(0, 10)}` : "Fathom has not synced a call yet");
  if (read.agents.connected && agentCount > 0) {
    parts.push(`${agentCount} Paperclip agent${agentCount === 1 ? "" : "s"} active`);
  }
  return parts.join(" · ");
}
