/**
 * Paperclip reconciliation edge function. Phase 6.
 *
 * Runs on a schedule (every 5 minutes via cron) and on-demand (GET/POST).
 * Reconciles Paperclip agent state into Trust Tai OS execution_agents +
 * execution_bindings. Does not hold any state between invocations.
 *
 * Schedule: set via Supabase cron (supabase/config.toml) or Lovable dashboard.
 * On-demand: POST /functions/v1/paperclip-reconcile with { organizationId }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const PAPERCLIP_API_URL = Deno.env.get("PAPERCLIP_API_URL") ?? "http://127.0.0.1:3100";
const PAPERCLIP_BOARD_KEY = Deno.env.get("PAPERCLIP_BOARD_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("TRUST_TAI_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("TRUST_TAI_SUPABASE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TRUST_TAI_ORG_ID = Deno.env.get("TRUST_TAI_ORG_ID") ?? "";
const EXECUTION_KEY = Deno.env.get("TRUST_TAI_EXECUTION_KEY") ?? "";

const COMPANY_ID = "aaa4eceb-44fb-4492-823c-65d3d90c5519";

async function paperclipGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${PAPERCLIP_BOARD_KEY}` },
  });
  if (!res.ok) throw new Error(`Paperclip ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function paperclipGetSafe<T>(path: string): Promise<T | null> {
  try { return await paperclipGet<T>(path); }
  catch { return null; }
}

Deno.serve(async (req: Request) => {
  // Auth guard — only accept requests with the execution key or internal Supabase invocation
  const authHeader = req.headers.get("Authorization") ?? "";
  const executionKey = req.headers.get("X-Execution-Key") ?? "";
  const isServiceRole = authHeader.includes(SERVICE_ROLE_KEY);
  const isExecutionKey = EXECUTION_KEY && executionKey === EXECUTION_KEY;
  const isScheduled = req.headers.get("X-Supabase-Event-Type") === "scheduled";

  if (!isServiceRole && !isExecutionKey && !isScheduled) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Determine org to reconcile (body or default)
  let organizationId = TRUST_TAI_ORG_ID;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { organizationId?: string };
      if (body.organizationId) organizationId = body.organizationId;
    }
  } catch { /* use default */ }

  if (!organizationId) {
    return new Response(JSON.stringify({ error: "No organizationId" }), { status: 400 });
  }

  const now = new Date().toISOString();
  const results: { agentId: string; status: string; error: string | null }[] = [];

  // 1. Read registered agents from DB
  const { data: agentRows, error: agentsError } = await supabase
    .from("execution_agents")
    .select("id, paperclip_agent_id, name, enabled")
    .eq("organization_id", organizationId)
    .eq("enabled", true);

  if (agentsError || !agentRows) {
    await supabase.from("paperclip_sync_state").upsert({
      organization_id: organizationId,
      resource_type: "agents",
      last_error: agentsError?.message ?? "Could not read execution_agents",
      consecutive_failures: 1,
      updated_at: now,
    }, { onConflict: "organization_id,resource_type" });
    return new Response(JSON.stringify({ error: "Failed to read agents" }), { status: 500 });
  }

  let totalErrors = 0;

  for (const row of agentRows) {
    const agentId = row.paperclip_agent_id as string;
    let syncError: string | null = null;

    try {
      // 2. Fetch live agent from Paperclip
      const agent = await paperclipGet<{
        id: string; companyId: string; status: string;
        lastHeartbeatAt?: string | null; pausedAt?: string | null;
      }>(`/api/agents/${agentId}`);

      // 3. Project status back into execution_agents
      // Pause is status="paused"; pausedAt only populates on company-level pause.
      const pausedByStatus = agent.status === "paused";
      await supabase.from("execution_agents").update({
        last_known_status: agent.status,
        last_synced_at: now,
        last_heartbeat_at: agent.lastHeartbeatAt ?? null,
        paused_at: pausedByStatus ? (agent.pausedAt ?? now) : null,
        paperclip_company_id: agent.companyId,
        updated_at: now,
      }).eq("paperclip_agent_id", agentId);

      // 4. Fetch completed issues and sync binding completions
      const doneRes = await paperclipGetSafe<Array<{ id: string; status: string; title: string; completedAt?: string | null }>>(
        `/api/companies/${COMPANY_ID}/issues?assigneeAgentId=${agentId}&status=done&limit=20`,
      );

      if (doneRes) {
        for (const issue of doneRes) {
          if (issue.status === "done" && issue.id) {
            await supabase
              .from("execution_bindings")
              .update({
                status: "completed",
                result_summary: issue.title,
                updated_at: now,
              })
              .eq("paperclip_issue_id", issue.id)
              .in("status", ["dispatched", "dispatching", "in_progress"]);
          }
        }
      }
    } catch (error) {
      syncError = error instanceof Error ? error.message : "Unknown error";
      totalErrors++;
    }

    results.push({ agentId, status: syncError ? "error" : "ok", error: syncError });
  }

  // 5. Update sync state cursor
  await supabase.from("paperclip_sync_state").upsert({
    organization_id: organizationId,
    resource_type: "agents",
    last_success_at: totalErrors === 0 ? now : undefined,
    last_error: totalErrors > 0 ? `${totalErrors} agent(s) failed to sync.` : null,
    consecutive_failures: totalErrors,
    updated_at: now,
  }, { onConflict: "organization_id,resource_type" });

  return new Response(JSON.stringify({ syncedAt: now, organizationId, results, totalErrors }), {
    headers: { "Content-Type": "application/json" },
  });
});
