/**
 * Steward's read layer over the Paperclip workforce (server only).
 *
 * Paperclip owns agent execution state. Steward only reads it, presents it in
 * human language, and never claims a completion Paperclip has not reported.
 * When Paperclip is not reachable the room says exactly that.
 */

import type {
  AgentLifecycle,
  StewardAgent,
  StewardAgentRead,
  StewardAgentTask,
} from "@/domain/steward-accountability";

const WEEK = 7 * 86_400_000;

/** Boundaries every Trust Tai agent has, regardless of capability list. */
const UNIVERSAL_BOUNDARIES = [
  "Cannot approve its own work or grant itself new authority.",
  "Cannot change Roadmap decisions or Projects delivery truth directly.",
  "Cannot contact a client without a human authorising the message.",
];

function lifecycleOf(agentStatus: string, issues: { status: string }[]): AgentLifecycle {
  const status = (agentStatus ?? "").toLowerCase();
  if (issues.some((issue) => /review|approval/i.test(issue.status))) return "needs_approval";
  if (issues.some((issue) => /blocked/i.test(issue.status))) return "waiting";
  if (issues.some((issue) => /in_progress|working/i.test(issue.status))) return "working";
  if (issues.some((issue) => /todo|queued/i.test(issue.status))) return "queued";
  if (status === "running" || status === "working") return "working";
  if (status === "failed" || status === "error") return "failed";
  if (status === "idle" || status === "ready" || status === "active") return "idle";
  return status ? "unknown" : "idle";
}

function toTask(issue: {
  id: string;
  title: string;
  status: string;
  updatedAt?: string | null;
}): StewardAgentTask {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
  };
}

function responsibilityOf(record: {
  owning_app: string;
  metadata: Record<string, unknown> | null;
}): string {
  const metadata = record.metadata ?? {};
  const stated = metadata["responsibility"];
  if (typeof stated === "string" && stated.trim()) return stated.trim();
  return `Execution for ${record.owning_app}.`;
}

function boundariesOf(metadata: Record<string, unknown> | null): string[] {
  const stated = (metadata ?? {})["cannot_do"];
  const extra = Array.isArray(stated)
    ? stated.filter((value): value is string => typeof value === "string")
    : [];
  return [...extra, ...UNIVERSAL_BOUNDARIES];
}

/** Every registered agent for this workspace, with its real Paperclip state. */
export async function readStewardAgents(organizationId: string): Promise<StewardAgentRead> {
  let listExecutionAgents: (id: string) => Promise<Record<string, unknown>[]>;
  let paperclip: typeof import("@/lib/paperclip-client.server").paperclipClient;
  try {
    const bridge = await import("@/lib/execution-bridge.server");
    const client = await import("@/lib/paperclip-client.server");
    listExecutionAgents = bridge.listExecutionAgents as unknown as typeof listExecutionAgents;
    paperclip = client.paperclipClient;
  } catch (error) {
    return {
      agents: [],
      connected: false,
      because: error instanceof Error ? error.message : "The execution bridge is not available.",
    };
  }

  let records: Record<string, unknown>[];
  try {
    records = await listExecutionAgents(organizationId);
  } catch (error) {
    return {
      agents: [],
      connected: false,
      because:
        error instanceof Error
          ? `The agent registry could not be read. ${error.message}`
          : "The agent registry could not be read.",
    };
  }

  if (records.length === 0) {
    return {
      agents: [],
      connected: true,
      because: "No Paperclip agents are registered for this workspace yet.",
    };
  }

  const since = new Date(Date.now() - WEEK).toISOString();
  const agents: StewardAgent[] = [];
  let reachable = false;
  let firstFailure: string | null = null;

  for (const record of records) {
    const paperclipAgentId = String(record["paperclip_agent_id"] ?? "");
    const name = String(record["name"] ?? "Agent");
    const owningApp = String(record["owning_app"] ?? "unknown");
    const capabilities = Array.isArray(record["capabilities"])
      ? (record["capabilities"] as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const metadata = (record["metadata"] ?? null) as Record<string, unknown> | null;

    const base: StewardAgent = {
      id: String(record["id"] ?? paperclipAgentId),
      paperclipAgentId,
      name,
      responsibility: responsibilityOf({ owning_app: owningApp, metadata }),
      owningApp,
      lifecycle: "unknown",
      capabilities,
      cannotDo: boundariesOf(metadata),
      currentWork: null,
      activeTasks: [],
      awaitingApproval: [],
      completedThisWeek: 0,
      lastHeartbeatAt: null,
      recentOutcome: null,
    };

    try {
      const agent = await paperclip.getAgent(paperclipAgentId);
      const [open, done] = await Promise.all([
        paperclip.getIssues(agent.companyId, {
          assigneeAgentId: paperclipAgentId,
          limit: 25,
          status: ["todo", "in_progress", "in_review", "blocked"],
        }),
        paperclip.getIssues(agent.companyId, {
          assigneeAgentId: paperclipAgentId,
          limit: 50,
          status: ["done"],
        }),
      ]);
      reachable = true;
      const awaiting = open.filter((issue) => /review|approval/i.test(issue.status));
      const active = open.filter((issue) => !/review|approval/i.test(issue.status));
      const working = active.find((issue) => /in_progress|working/i.test(issue.status));
      agents.push({
        ...base,
        lifecycle: lifecycleOf(agent.status, open),
        ...(agent.role ? { responsibility: agent.role } : {}),
        currentWork: working?.title ?? null,
        activeTasks: active.map(toTask),
        awaitingApproval: awaiting.map(toTask),
        completedThisWeek: done.filter((issue) => (issue.completedAt ?? "") >= since).length,
        lastHeartbeatAt: agent.lastHeartbeatAt ?? null,
        recentOutcome: done[0]?.title ?? null,
      });
    } catch (error) {
      if (!firstFailure) {
        firstFailure = error instanceof Error ? error.message : "Paperclip did not respond.";
      }
      agents.push(base);
    }
  }

  return {
    agents,
    connected: reachable,
    because: reachable
      ? `${agents.length} agent${agents.length === 1 ? "" : "s"} registered.`
      : `Paperclip is registered but not responding. ${firstFailure ?? ""}`.trim(),
  };
}
