#!/usr/bin/env npx tsx
/**
 * Local reconcile sweep — mirrors supabase/functions/paperclip-reconcile.
 *
 * Runs on the laptop (launchd com.trusttai.reconcile-sweep, 300s) because
 * Paperclip is laptop-local (127.0.0.1:3100, private exposure). The edge fn
 * stays deployed but unscheduled; when Paperclip gets a public URL, switch:
 * set PAPERCLIP_API_URL secret + dashboard schedule, then unload local plist.
 *
 * Reads .env.local for credentials (never committed).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// --- env ---
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
}

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100";
const PAPERCLIP_BOARD_KEY = process.env.PAPERCLIP_BOARD_KEY ?? "";
const SUPABASE_URL = process.env.TRUST_TAI_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.TRUST_TAI_SUPABASE_SERVICE_KEY ?? "";
const TRUST_TAI_ORG_ID = process.env.TRUST_TAI_ORG_ID ?? "ee683a64-e045-4226-a8ff-4ae6590d6789";
const COMPANY_ID = "aaa4eceb-44fb-4492-823c-65d3d90c5519";

if (!PAPERCLIP_BOARD_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("reconcile-sweep: missing env (PAPERCLIP_BOARD_KEY / TRUST_TAI_SUPABASE_URL / TRUST_TAI_SUPABASE_SERVICE_KEY)");
  process.exit(1);
}

async function pcGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${PAPERCLIP_BOARD_KEY}` },
  });
  if (!res.ok) throw new Error(`Paperclip ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function pcGetSafe<T>(path: string): Promise<T | null> {
  try { return await pcGet<T>(path); } catch { return null; }
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date().toISOString();
  const organizationId = TRUST_TAI_ORG_ID;

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
    console.error(`reconcile-sweep: failed to read agents — ${agentsError?.message}`);
    process.exit(1);
  }

  let totalErrors = 0;

  for (const row of agentRows) {
    const agentId = row.paperclip_agent_id as string;
    let syncError: string | null = null;

    try {
      // 2. Fetch live agent from Paperclip
      const agent = await pcGet<{
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
      const doneRes = await pcGetSafe<Array<{ id: string; status: string; title: string; completedAt?: string | null }>>(
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

    if (syncError) console.error(`  ${row.name}: ERROR ${syncError}`);
    else console.log(`  ${row.name}: ok (${agentId.slice(0, 8)})`);
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

  console.log(`reconcile-sweep: ${agentRows.length} agent(s), ${totalErrors} error(s) @ ${now}`);
  if (totalErrors > 0) process.exit(2);
}

main().catch((e) => {
  console.error(`reconcile-sweep: fatal — ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
