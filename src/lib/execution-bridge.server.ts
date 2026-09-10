import { createClient } from "@supabase/supabase-js";

import type { ExecutionDatabase } from "@/lib/execution-bridge.types";
import { trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

const SCOUT_PIPELINE_TARGET = 15;

type Json = Record<string, unknown>;

export interface ExecutionAgentRecord {
  id: string;
  organization_id: string;
  paperclip_agent_id: string;
  name: string;
  owning_app: string;
  principal: string;
  capabilities: string[] | null;
  enabled: boolean;
  metadata: Json | null;
  // Phase 4-6 sync projection fields
  last_known_status: string | null;
  last_synced_at: string | null;
  paperclip_company_id: string | null;
  paused_at: string | null;
  last_heartbeat_at: string | null;
  routine_ids: string[] | null;
}

export interface ExecutionBindingRecord {
  id: string;
  organization_id: string;
  source_app: string;
  source_entity_type?: string | null;
  source_entity_id?: string | null;
  conductor_action_id?: string | null;
  paperclip_company_id: string;
  paperclip_issue_id?: string | null;
  paperclip_agent_id: string;
  paperclip_run_id?: string | null;
  objective: string;
  expected_outcome?: string | null;
  status: string;
  result_summary?: string | null;
  business_outputs: Json | null;
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutionBindingInput {
  organizationId: string;
  sourceApp: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  conductorActionId?: string | null;
  paperclipCompanyId: string;
  paperclipIssueId?: string | null;
  paperclipAgentId: string;
  paperclipRunId?: string | null;
  objective: string;
  expectedOutcome?: string | null;
  status?: string;
  resultSummary?: string | null;
  businessOutputs?: Json;
  idempotencyKey?: string | null;
}

export interface ExecutionBindingResult {
  status: string;
  resultSummary?: string | null;
  businessOutputs?: Json;
}

function serviceRoleKey(): string {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new Error("Missing Trust Tai Supabase service-role key.");
  }
  return key;
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

type ExecutionClient = ReturnType<typeof createClient<ExecutionDatabase>>;

let serviceRoleClient: ExecutionClient | undefined;

export function trustTaiServiceRoleClient(): ExecutionClient {
  if (!serviceRoleClient) {
    const key = serviceRoleKey();
    serviceRoleClient = createClient<ExecutionDatabase>(trustTaiSupabaseUrl(), key, {
      global: { fetch: createSupabaseFetch(key) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceRoleClient;
}

export function executionKey(): string {
  const key = process.env["TRUST_TAI_EXECUTION_KEY"];
  if (!key) throw new Error("Missing TRUST_TAI_EXECUTION_KEY.");
  return key;
}

export function assertExecutionKey(request: Request) {
  const header = request.headers.get("X-Execution-Key");
  if (!header || header !== executionKey()) {
    throw new Error("Unauthorized execution request.");
  }
}

export function executionAgentId(request: Request): string {
  const agentId = request.headers.get("X-Agent-Id")?.trim();
  if (!agentId) throw new Error("Missing X-Agent-Id.");
  return agentId;
}

export async function validateAgent(
  paperclipAgentId: string,
  capability: string,
): Promise<ExecutionAgentRecord> {
  const supabase = trustTaiServiceRoleClient();
  const { data, error } = await supabase
    .from("execution_agents")
    .select("*")
    .eq("paperclip_agent_id", paperclipAgentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Execution agent ${paperclipAgentId} is not registered.`);

  const agent = data as unknown as ExecutionAgentRecord;
  if (!agent.enabled) throw new Error(`Execution agent ${paperclipAgentId} is disabled.`);
  if (!agent.capabilities?.includes(capability)) {
    throw new Error(`Execution agent ${paperclipAgentId} lacks ${capability}.`);
  }
  return agent;
}

export async function listExecutionAgents(organizationId: string): Promise<ExecutionAgentRecord[]> {
  const { data, error } = await trustTaiServiceRoleClient()
    .from("execution_agents")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ExecutionAgentRecord[];
}

export async function latestExecutionBinding(
  organizationId: string,
  paperclipAgentId: string,
): Promise<ExecutionBindingRecord | null> {
  const { data, error } = await trustTaiServiceRoleClient()
    .from("execution_bindings")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("paperclip_agent_id", paperclipAgentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as unknown as ExecutionBindingRecord | undefined) ?? null;
}

export async function recordBinding(input: ExecutionBindingInput): Promise<ExecutionBindingRecord> {
  const supabase = trustTaiServiceRoleClient();

  if (input.idempotencyKey) {
    const { data: existing, error: existingError } = await supabase
      .from("execution_bindings")
      .select("*")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return existing as unknown as ExecutionBindingRecord;
  }

  const payload = {
    organization_id: input.organizationId,
    source_app: input.sourceApp,
    source_entity_type: input.sourceEntityType ?? null,
    source_entity_id: input.sourceEntityId ?? null,
    conductor_action_id: input.conductorActionId ?? null,
    paperclip_company_id: input.paperclipCompanyId,
    paperclip_issue_id: input.paperclipIssueId ?? null,
    paperclip_agent_id: input.paperclipAgentId,
    paperclip_run_id: input.paperclipRunId ?? null,
    objective: input.objective,
    expected_outcome: input.expectedOutcome ?? null,
    status: input.status ?? "dispatched",
    result_summary: input.resultSummary ?? null,
    business_outputs: input.businessOutputs ?? {},
    idempotency_key: input.idempotencyKey ?? null,
  };

  const { data, error } = await supabase
    .from("execution_bindings")
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Execution binding insert returned no row.");
  return data as unknown as ExecutionBindingRecord;
}

export async function completeBinding(
  bindingId: string,
  result: ExecutionBindingResult,
): Promise<ExecutionBindingRecord> {
  const { data, error } = await trustTaiServiceRoleClient()
    .from("execution_bindings")
    .update({
      status: result.status,
      result_summary: result.resultSummary ?? null,
      business_outputs: result.businessOutputs ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", bindingId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Execution binding ${bindingId} was not found.`);
  return data as unknown as ExecutionBindingRecord;
}

export async function scoutPipelineState(organizationId: string, target = SCOUT_PIPELINE_TARGET) {
  const supabase = trustTaiServiceRoleClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [qualifiedResult, readyResult, recentResult] = await Promise.all([
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "qualified"),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "ready_for_comms"),
    supabase
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", since),
  ]);

  if (qualifiedResult.error) throw new Error(qualifiedResult.error.message);
  if (readyResult.error) throw new Error(readyResult.error.message);
  if (recentResult.error) throw new Error(recentResult.error.message);

  const qualified = qualifiedResult.count ?? 0;
  const readyForComms = readyResult.count ?? 0;
  const recent7d = recentResult.count ?? 0;
  const current = qualified + readyForComms;
  const deficit = Math.max(0, target - current);

  return {
    organizationId,
    qualified,
    readyForComms,
    recent7d,
    current,
    deficit,
    target,
    sourcingWarranted: current < target || recent7d < 3,
  };
}

export async function latestIcpProfile(organizationId: string) {
  const { data, error } = await trustTaiServiceRoleClient()
    .from("icp_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .order("version", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? [])[0] ?? null;
}

export function scoutPipelineTarget() {
  return SCOUT_PIPELINE_TARGET;
}

/** Update an agent's sync projection fields after a live read from Paperclip. */
export async function updateAgentSyncProjection(input: {
  paperclipAgentId: string;
  lastKnownStatus: string;
  pausedAt: string | null;
  lastHeartbeatAt: string | null;
  paperclipCompanyId?: string | null;
}): Promise<void> {
  const { error } = await trustTaiServiceRoleClient()
    .from("execution_agents")
    .update({
      last_known_status: input.lastKnownStatus,
      last_synced_at: new Date().toISOString(),
      paused_at: input.pausedAt,
      last_heartbeat_at: input.lastHeartbeatAt,
      ...(input.paperclipCompanyId ? { paperclip_company_id: input.paperclipCompanyId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("paperclip_agent_id", input.paperclipAgentId);
  if (error) throw new Error(error.message);
}

/** Upsert a sync state cursor row. Marks success or failure. */
export async function upsertSyncState(input: {
  organizationId: string;
  resourceType: string;
  success: boolean;
  error?: string | null;
  cursor?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const supabase = trustTaiServiceRoleClient();

  const { data: existing } = await supabase
    .from("paperclip_sync_state")
    .select("id, consecutive_failures")
    .eq("organization_id", input.organizationId)
    .eq("resource_type", input.resourceType)
    .maybeSingle();

  const consecutiveFailures = input.success
    ? 0
    : ((existing as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0) + 1;

  const upsertPayload: {
    organization_id: string;
    resource_type: string;
    last_success_at?: string | null;
    last_cursor: string | null;
    last_error: string | null;
    consecutive_failures: number;
    updated_at: string;
  } = {
    organization_id: input.organizationId,
    resource_type: input.resourceType,
    last_cursor: input.cursor ?? null,
    last_error: input.success ? null : (input.error ?? "Unknown error"),
    consecutive_failures: consecutiveFailures,
    updated_at: now,
  };
  if (input.success) upsertPayload.last_success_at = now;

  const { error } = await supabase
    .from("paperclip_sync_state")
    .upsert(upsertPayload, { onConflict: "organization_id,resource_type" });
  if (error) throw new Error(error.message);
}

/** Read the sync health for an org. */
export async function getSyncState(
  organizationId: string,
): Promise<{ resourceType: string; lastSuccessAt: string | null; consecutiveFailures: number }[]> {
  const { data, error } = await trustTaiServiceRoleClient()
    .from("paperclip_sync_state")
    .select("resource_type, last_success_at, consecutive_failures")
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    resourceType: String((row as { resource_type: string }).resource_type),
    lastSuccessAt: (row as { last_success_at: string | null }).last_success_at,
    consecutiveFailures: Number((row as { consecutive_failures: number }).consecutive_failures),
  }));
}

/** Mark a binding complete when Paperclip reports the issue done. */
export async function syncBindingCompletion(input: {
  paperclipIssueId: string;
  status: string;
  resultSummary?: string | null;
}): Promise<void> {
  const terminalStatuses = ["done", "cancelled", "completed"];
  if (!terminalStatuses.some((s) => input.status.toLowerCase().includes(s))) return;

  const { error } = await trustTaiServiceRoleClient()
    .from("execution_bindings")
    .update({
      status: input.status === "done" ? "completed" : "cancelled",
      result_summary: input.resultSummary ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("paperclip_issue_id", input.paperclipIssueId)
    .in("status", ["dispatched", "dispatching", "in_progress"]);
  if (error) throw new Error(error.message);
}
