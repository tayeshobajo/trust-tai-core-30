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
import { paperclipConnection } from "@/domain/paperclip-connection";
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
  syncHealth: null,
  liveFailureDetail: null,
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
      getStewardAgents({ data: { organizationId } }).catch((error: unknown): StewardAgentRead => ({
        ...NO_AGENTS,
        because:
          error instanceof Error
            ? `Paperclip could not be read. ${error.message}`
            : NO_AGENTS.because,
      })),
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

/**
 * Fathom's real sync state, expressed only from rows Steward actually has.
 *
 * "Synced" means when Steward stored the call, which is not the same thing as
 * when the meeting happened, so both are said plainly. Counts describe only
 * what was read from those calls.
 */
/** When Steward last stored a Fathom call, or null when it never has. */
export function fathomLastSync(read: StewardTeamRead | undefined): string | null {
  if (!read) return null;
  const stamps = read.conversations
    .filter((row) => row.provider === "fathom")
    .map((row) => row.ingestedAt || row.occurredAt)
    .filter(Boolean)
    .sort();
  return stamps.length > 0 ? (stamps[stamps.length - 1] as string) : null;
}

export function fathomStatusLine(read: StewardTeamRead | undefined): string | null {
  if (!read) return null;

  const calls = read.conversations.filter((row) => row.provider === "fathom");
  const parts: string[] = [];

  if (calls.length === 0) {
    parts.push("No Fathom call has been read yet");
  } else {
    const syncedAt = calls
      .map((row) => row.ingestedAt || row.occurredAt)
      .filter(Boolean)
      .sort()
      .pop();
    const ids = new Set(calls.map((row) => row.id));
    const derived = read.commitments.filter((row) => ids.has(row.conversationId)).length;
    parts.push(
      `${calls.length} Fathom call${calls.length === 1 ? "" : "s"} read${
        syncedAt ? `, last synced ${syncedAt.slice(0, 10)}` : ""
      }`,
    );
    parts.push(`${derived} promise${derived === 1 ? "" : "s"} taken from them`);
  }

  const agentCount = read.agents.agents.length;
  const connection = paperclipConnection({
    liveReachable: read.agents.connected,
    lastSuccessAt: read.agents.syncHealth?.lastSuccessAt ?? null,
  });
  if (read.agents.connected && agentCount > 0) {
    parts.push(`${agentCount} Paperclip agent${agentCount === 1 ? "" : "s"} active`);
  } else if (agentCount > 0 || !read.agents.connected) {
    parts.push(connection.label);
  }

  return parts.join(" · ");
}
