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

/**
 * Ask Paperclip to take one task. Steward records the binding with a
 * correlation ID and idempotency key so the same task cannot be dispatched
 * twice, even on retry.
 */
export async function assignPaperclipTask(input: {
  organizationId: string;
  agentId: string;
  title: string;
  description: string;
  /** Trust Tai task key, used as the idempotency key base. */
  sourceEntityId?: string | null;
  sourceEntityType?: string | null;
  sourceApp?: string | null;
}): Promise<{ issueId: string; bindingId: string; isNew: boolean }> {
  const { paperclipClient } = await import("@/lib/paperclip-client.server");
  const { recordBinding } = await import("@/lib/execution-bridge.server");

  // Idempotency key: scoped to org + source entity so the same Trust Tai task
  // can never land in Paperclip more than once.
  const idempotencyKey = input.sourceEntityId
    ? `trusttai:task:${input.organizationId}:${input.sourceEntityId}`
    : `trusttai:task:${input.organizationId}:${input.agentId}:${Date.now()}`;

  const agent = await paperclipClient.getAgent(input.agentId);

  // Record the binding first. `recordBinding` returns the existing record if
  // the idempotency key already exists — no duplicate Paperclip issue created.
  const binding = await recordBinding({
    organizationId: input.organizationId,
    sourceApp: input.sourceApp ?? "steward",
    sourceEntityType: input.sourceEntityType ?? "task",
    sourceEntityId: input.sourceEntityId ?? null,
    paperclipCompanyId: agent.companyId,
    paperclipAgentId: input.agentId,
    objective: input.title,
    status: "dispatching",
    idempotencyKey,
  });

  // If the binding already has a Paperclip issue, this was a retry — return
  // the existing record without creating a duplicate issue.
  if (binding.paperclip_issue_id) {
    return { issueId: binding.paperclip_issue_id, bindingId: binding.id, isNew: false };
  }

  const issue = await paperclipClient.createIssue(agent.companyId, {
    title: input.title,
    description: `${input.description}\n\n---\nTrust Tai source: ${input.sourceApp ?? "steward"}\nCorrelation key: ${idempotencyKey}`,
    createdByAgentId: input.agentId,
    assigneeAgentId: input.agentId,
    status: "todo",
  });

  // Update the binding with the Paperclip issue ID and mark dispatched.
  const { completeBinding } = await import("@/lib/execution-bridge.server");
  await completeBinding(binding.id, {
    status: "dispatched",
  });

  // Patch the issue ID onto the binding row directly.
  const { trustTaiServiceRoleClient } = await import("@/lib/execution-bridge.server");
  await trustTaiServiceRoleClient()
    .from("execution_bindings")
    .update({ paperclip_issue_id: issue.id, status: "dispatched" })
    .eq("id", binding.id);

  return { issueId: issue.id, bindingId: binding.id, isNew: true };
}

/**
 * Single-org workspace: the org row must exist and the caller must hold a
 * validated session. Untyped context on purpose, the generated Database types
 * do not describe this externally managed schema.
 */
export async function assertStewardMembership(
  context: { supabase: any },
  organizationId: string,
): Promise<void> {
  const { data, error } = await context.supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You are not a member of this Trust Tai workspace.");
}
