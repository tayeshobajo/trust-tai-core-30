/**
 * Steward's read + write layer over the Paperclip workforce (server only).
 *
 * Paperclip owns agent execution state. Steward only reads it, presents it in
 * human language, and never claims a completion Paperclip has not reported.
 * Phase 4-6: adds comment timeline, pause/resume, routine visibility, sync health.
 */

import type {
  AgentLifecycle,
  StewardAgent,
  StewardAgentActivityItem,
  StewardAgentRead,
  StewardAgentRoutine,
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

function toRoutine(r: import("@/lib/paperclip-client.server").PaperclipRoutine): StewardAgentRoutine {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    lastRunAt: r.lastRun?.completedAt ?? r.lastTriggeredAt ?? null,
    lastRunStatus: r.lastRun?.status ?? null,
    lastRunIssueTitle: r.lastRun?.linkedIssue?.title ?? null,
  };
}

function toActivityItem(
  comment: import("@/lib/paperclip-client.server").PaperclipComment,
): StewardAgentActivityItem {
  const isAgent = comment.authorType === "agent";
  return {
    id: comment.id,
    kind: "comment",
    authorKind: isAgent ? "agent" : "human",
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

/** Every registered agent for this workspace, with its real Paperclip state. */
export async function readStewardAgents(organizationId: string): Promise<StewardAgentRead> {
  let reconcile: typeof import("@/lib/paperclip-reconcile.server").reconcilePaperclipAgents;
  let listExecutionAgents: (id: string) => Promise<Record<string, unknown>[]>;
  let getSyncState: typeof import("@/lib/execution-bridge.server").getSyncState;
  try {
    const rec = await import("@/lib/paperclip-reconcile.server");
    const bridge = await import("@/lib/execution-bridge.server");
    reconcile = rec.reconcilePaperclipAgents;
    listExecutionAgents = bridge.listExecutionAgents as unknown as typeof listExecutionAgents;
    getSyncState = bridge.getSyncState;
  } catch (error) {
    return {
      agents: [],
      connected: false,
      syncHealth: null,
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
      syncHealth: null,
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
      syncHealth: null,
      because: "No Paperclip agents are registered for this workspace yet.",
    };
  }

  // Run reconciliation (updates DB projections + binding completions)
  let reconcileResult: Awaited<ReturnType<typeof reconcile>>;
  try {
    reconcileResult = await reconcile(organizationId);
  } catch {
    reconcileResult = {
      organizationId,
      agents: [],
      syncedAt: new Date().toISOString(),
      totalErrors: records.length,
    };
  }

  const since = new Date(Date.now() - WEEK).toISOString();
  const agents: StewardAgent[] = [];
  let reachable = false;
  let firstFailure: string | null = null;

  // Build map from reconcile results for fast lookup
  const reconcileMap = new Map(
    reconcileResult.agents.map((r) => [r.agentId, r]),
  );

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
      routines: [],
      activityTimeline: [],
      pendingApprovals: 0,
      lastHeartbeatAt: (record["last_heartbeat_at"] as string | null) ?? null,
      isPaused:
        Boolean(record["paused_at"]) ||
        String(record["last_known_status"] ?? "") === "paused",
    };
    // Projection freshness: when live Paperclip is unreachable (e.g. production
    // while Paperclip runs laptop-local), hydrate lifecycle from the reconcile
    // sweep's projection instead of showing raw "unknown".
    const projectedStatus = String(record["last_known_status"] ?? "").toLowerCase();
    if (projectedStatus) {
      base.lifecycle = lifecycleOf(projectedStatus, []);
    }

    const rec = reconcileMap.get(paperclipAgentId);
    if (rec && !rec.error) {
      reachable = true;
      const open = rec.openIssues;
      const awaiting = open.filter((issue) => /review|approval/i.test(issue.status));
      const active = open.filter((issue) => !/review|approval/i.test(issue.status));
      const working = active.find((issue) => /in_progress|working/i.test(issue.status));

      // Fetch done issues for this week count + recent outcome
      let doneIssues: import("@/lib/paperclip-client.server").PaperclipIssue[] = [];
      try {
        const { paperclipClient } = await import("@/lib/paperclip-client.server");
        doneIssues = await paperclipClient.getIssues(rec.companyId, {
          assigneeAgentId: paperclipAgentId,
          limit: 20,
          status: ["done"],
        });
      } catch { /* non-fatal */ }

      // Fetch comments for the most recent active/done issue (activity timeline)
      let activityTimeline: StewardAgentActivityItem[] = [];
      const latestIssueId = working?.id ?? doneIssues[0]?.id;
      if (latestIssueId) {
        try {
          const { paperclipClient } = await import("@/lib/paperclip-client.server");
          const comments = await paperclipClient.getIssueComments(latestIssueId);
          activityTimeline = comments
            .filter((c) => !c.deletedAt)
            .slice(0, 10)
            .map(toActivityItem);
        } catch { /* non-fatal */ }
      }

      agents.push({
        ...base,
        lifecycle: lifecycleOf(rec.status, open),
        currentWork: working?.title ?? null,
        activeTasks: active.map(toTask),
        awaitingApproval: awaiting.map(toTask),
        completedThisWeek: doneIssues.filter((i) => (i.completedAt ?? "") >= since).length,
        lastHeartbeatAt: rec.lastHeartbeatAt,
        recentOutcome: doneIssues[0]?.title ?? null,
        routines: rec.routines.map(toRoutine),
        activityTimeline,
        pendingApprovals: rec.approvals.length,
        isPaused: rec.pausedAt != null || rec.status === "paused",
      });
    } else {
      if (rec?.error && !firstFailure) firstFailure = rec.error;
      agents.push(base);
    }
  }

  // Sync health summary
  let syncHealth: StewardAgentRead["syncHealth"] = null;
  try {
    const states = await getSyncState(organizationId);
    const agentState = states.find((s) => s.resourceType === "agents");
    if (agentState) {
      syncHealth = {
        lastSuccessAt: agentState.lastSuccessAt,
        consecutiveFailures: agentState.consecutiveFailures,
      };
    }
  } catch { /* non-fatal */ }

  return {
    agents,
    connected: reachable,
    syncHealth,
    because: reachable
      ? `${agents.length} agent${agents.length === 1 ? "" : "s"} registered.`
      : firstFailure?.includes("Missing PAPERCLIP_BOARD_KEY")
        ? `Live Paperclip state is not configured here (no board key on this deployment). Showing the registry with the last synchronized state from ${syncHealth?.lastSuccessAt ?? "the last sweep"}.`
        : firstFailure?.includes("fetch failed") || firstFailure?.toLowerCase().includes("econnrefused")
          ? `Paperclip is running locally and not reachable from this deployment. Showing the registry with the last synchronized state from ${syncHealth?.lastSuccessAt ?? "the last sweep"}.`
          : `Paperclip is not responding right now. ${firstFailure ?? ""} Showing the registry with the last synchronized state from ${syncHealth?.lastSuccessAt ?? "the last sweep"}.`.trim(),
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
 * Pause or resume a Paperclip agent. Reflects the change via Paperclip PATCH.
 * Steward reads Paperclip's response as truth — it does not set its own paused flag.
 *
 * Paperclip pause is status="paused"; pausedAt may stay null on status-pause,
 * so we synthesize a timestamp for the UI when pausing.
 */
export async function setPaperclipAgentPaused(
  agentId: string,
  paused: boolean,
): Promise<{ status: string; pausedAt: string | null }> {
  const { paperclipClient } = await import("@/lib/paperclip-client.server");
  const updated = await paperclipClient.setAgentPaused(agentId, paused);
  const status = updated.status ?? (paused ? "paused" : "active");
  const pausedAt = paused
    ? (updated.pausedAt ??
       new Date().toISOString())
    : null;
  return { status, pausedAt };
}

/**
 * Post a Tai note into a Paperclip issue's comment thread.
 * Board key resolves as agent context in Paperclip — the comment will show
 * as agent-authored. We label it "[Tai via Trust Tai OS]" in the body so it
 * is distinguishable inside Paperclip's UI.
 */
export async function postTaiNoteToIssue(input: {
  issueId: string;
  note: string;
  taiName: string;
}): Promise<{ commentId: string }> {
  const { paperclipClient } = await import("@/lib/paperclip-client.server");
  const body = `[${input.taiName} via Trust Tai OS]\n\n${input.note.trim()}`;
  const comment = await paperclipClient.getIssueComments(input.issueId); // warm the connection
  void comment; // suppress unused warning — just ensuring Paperclip is reachable
  // Post comment without authorType (Paperclip infers from bearer token)
  const result = await fetch(
    `${process.env["PAPERCLIP_API_URL"] || "http://127.0.0.1:3100"}/api/issues/${input.issueId}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env["PAPERCLIP_BOARD_KEY"] ?? ""}`,
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!result.ok) {
    const text = await result.text();
    throw new Error(`Paperclip comment failed: ${result.status} ${text}`);
  }
  const data = (await result.json()) as { id: string };
  return { commentId: data.id };
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
