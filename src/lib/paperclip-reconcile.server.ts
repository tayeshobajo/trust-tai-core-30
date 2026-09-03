/**
 * Paperclip reconciliation engine. Phase 6.
 *
 * Runs on demand (page load lightweight check) and via the scheduled edge
 * function (full sweep every 5 minutes). Never holds stale state in memory.
 *
 * What this owns:
 * - Agent status projection (last_known_status, last_synced_at, paused_at, last_heartbeat_at)
 * - Binding completion sync (Paperclip done → execution_bindings.status = completed)
 * - Sync health cursor (paperclip_sync_state)
 *
 * What this does NOT own:
 * - Agent identity (that is Paperclip's truth)
 * - Business task completion (Projects decides for delivery tasks)
 * - Approval records (Paperclip owns them; we only read)
 */

import type { PaperclipAgent, PaperclipIssue, PaperclipRoutine } from "@/lib/paperclip-client.server";

export interface ReconcileAgentResult {
  agentId: string;
  name: string;
  status: string;
  pausedAt: string | null;
  lastHeartbeatAt: string | null;
  companyId: string;
  openIssues: PaperclipIssue[];
  routines: PaperclipRoutine[];
  approvals: Record<string, unknown>[];
  syncedAt: string;
  error: string | null;
}

export interface ReconcileResult {
  organizationId: string;
  agents: ReconcileAgentResult[];
  syncedAt: string;
  totalErrors: number;
}

/**
 * Full reconciliation sweep for one organisation. Reads all registered agents
 * from the Trust Tai DB, fetches their live state from Paperclip, projects
 * the status fields back into `execution_agents`, and marks completed bindings.
 *
 * Call this from the edge function cron AND from the Agents tab on load for
 * freshness. The result is used directly by the UI, no double fetch needed.
 */
export async function reconcilePaperclipAgents(
  organizationId: string,
): Promise<ReconcileResult> {
  const { paperclipClient } = await import("@/lib/paperclip-client.server");
  const {
    listExecutionAgents,
    updateAgentSyncProjection,
    upsertSyncState,
    syncBindingCompletion,
  } = await import("@/lib/execution-bridge.server");

  const now = new Date().toISOString();
  const syncedAtIso = now;
  const agents: ReconcileAgentResult[] = [];
  let totalErrors = 0;

  let records: Awaited<ReturnType<typeof listExecutionAgents>>;
  try {
    records = await listExecutionAgents(organizationId);
  } catch (error) {
    await upsertSyncState({
      organizationId,
      resourceType: "agents",
      success: false,
      error: error instanceof Error ? error.message: "Failed to read execution_agents.",
    });
    return { organizationId, agents, syncedAt: now, totalErrors: 1 };
  }

  for (const record of records) {
    const paperclipAgentId = String(record.paperclip_agent_id ?? "");
    const agentResult: ReconcileAgentResult = {
      agentId: paperclipAgentId,
      name: record.name,
      status: record.last_known_status ?? "unknown",
      pausedAt: record.paused_at ?? null,
      lastHeartbeatAt: record.last_heartbeat_at ?? null,
      companyId: record.paperclip_company_id ?? "aaa4eceb-44fb-4492-823c-65d3d90c5519",
      openIssues: [],
      routines: [],
      approvals: [],
      syncedAt: now,
      error: null,
    };

    try {
      // 1. Fetch live agent state
      const agent: PaperclipAgent = await paperclipClient.getAgent(paperclipAgentId);
      agentResult.status = agent.status ?? "unknown";
      agentResult.lastHeartbeatAt = agent.lastHeartbeatAt ?? null;
      agentResult.companyId = agent.companyId;

      // 2. Fetch open issues (working + queued)
      const [openIssues, doneIssues, routines, approvals] = await Promise.all([
        paperclipClient.getIssues(agent.companyId, {
          assigneeAgentId: paperclipAgentId,
          limit: 25,
          status: ["todo", "in_progress", "in_review", "blocked"],
        }),
        paperclipClient.getIssues(agent.companyId, {
          assigneeAgentId: paperclipAgentId,
          limit: 20,
          status: ["done"],
        }),
        paperclipClient.getRoutines(agent.companyId),
        paperclipClient.getApprovals(agent.companyId),
      ]);

      agentResult.openIssues = openIssues;
      agentResult.routines = routines.filter(
        (r) => r.assigneeAgentId === paperclipAgentId,
      );
      agentResult.approvals = approvals;

      // Paperclip models pause as status="paused" (AGENT_STATUSES); pausedAt is
      // only set for company-level pauses, so status is the reliable signal.
      const pausedByStatus = agent.status === "paused";

      // 3. Sync binding completions, mark dispatched bindings done when Paperclip says so
      for (const issue of doneIssues) {
        if (issue.id && issue.status === "done") {
          await syncBindingCompletion({
            paperclipIssueId: issue.id,
            status: "done",
            resultSummary: issue.title,
          }).catch(() => {
            /* Non-fatal, best-effort sync */
          });
        }
      }

      // 4. Project status back into DB
      await updateAgentSyncProjection({
        paperclipAgentId,
        lastKnownStatus: agent.status ?? "unknown",
        pausedAt: pausedByStatus
          ? (agent.pausedAt ?? syncedAtIso)
: null,
        lastHeartbeatAt: agent.lastHeartbeatAt ?? null,
        paperclipCompanyId: agent.companyId,
      });
      agentResult.pausedAt = pausedByStatus
        ? (agent.pausedAt ?? syncedAtIso)
: null;
    } catch (error) {
      agentResult.error = error instanceof Error ? error.message: "Paperclip did not respond.";
      totalErrors++;
    }

    agents.push(agentResult);
  }

  // 5. Update sync cursor
  await upsertSyncState({
    organizationId,
    resourceType: "agents",
    success: totalErrors === 0,
    error: totalErrors > 0 ? `${totalErrors} agent(s) failed to sync.`: null,
  }).catch(() => {
    /* Cursor failure is non-fatal */
  });

  return { organizationId, agents, syncedAt: now, totalErrors };
}
