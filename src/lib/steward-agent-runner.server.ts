import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyAgentTask, safeAgentArtifact } from "@/domain/steward-agent-execution";
import type { ManualTaskRecord } from "@/domain/steward-accountability";
import { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";

type Row = Record<string, unknown>;
const MODEL = "openai/gpt-6-astra";

export class AgentRunUnavailable extends Error {}

function taskFromRow(row: Row): ManualTaskRecord {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    title: String(row["title"]),
    priority: (row["priority"] ?? "normal") as ManualTaskRecord["priority"],
    assigneeKind: (row["assignee_kind"] ?? "human") as ManualTaskRecord["assigneeKind"],
    status: (row["status"] ?? "open") as ManualTaskRecord["status"],
    subtasks: Array.isArray(row["subtasks"])
      ? (row["subtasks"] as ManualTaskRecord["subtasks"])
      : [],
    acceptanceCriteria: Array.isArray(row["acceptance_criteria"])
      ? (row["acceptance_criteria"] as string[])
      : [],
    contextLinks: Array.isArray(row["context_links"])
      ? (row["context_links"] as ManualTaskRecord["contextLinks"])
      : [],
    ...(typeof row["notes"] === "string" ? { notes: row["notes"] } : {}),
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
  };
}

export type StewardAgentModelCall = (
  task: ManualTaskRecord,
) => Promise<{ artifact: string; evidenceRefs: string[]; model: string; runId: string | null }>;

export const callStewardAgentModel: StewardAgentModelCall = async (task) => {
  const key = process.env["LOVABLE_API_KEY"]?.trim();
  if (!key) throw new AgentRunUnavailable("AI is not configured, so the task stayed open.");
  const gateway = createLovableAiGatewayRunIdFetch();
  const response = await gateway.fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      store: false,
      reasoning: { effort: "medium", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      instructions:
        "You are a bounded internal preparation agent. Use only supplied context. Never send, publish, approve, promise, price, change scope or dates, or claim unsupported facts. Return JSON only with artifact and evidence_refs. Every claim must be grounded in a supplied evidence ref.",
      input: `Return json only. ${JSON.stringify({
        title: task.title,
        notes: task.notes ?? null,
        acceptance_criteria: task.acceptanceCriteria,
        context: task.contextLinks.map((link, index) => ({
          ref: `context:${index + 1}`,
          label: link.label,
          url: link.url,
        })),
      })}`,
      text: {
        format: {
          type: "json_schema",
          name: "steward_artifact",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["artifact", "evidence_refs"],
            properties: {
              artifact: { type: "string" },
              evidence_refs: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    }),
  });
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new AgentRunUnavailable(body.slice(0, 240) || `AI request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const event = JSON.parse(payload) as Row;
      if (event["type"] === "response.output_text.delta" && typeof event["delta"] === "string") {
        raw += event["delta"];
      }
      if (event["type"] === "response.refusal.delta") {
        throw new AgentRunUnavailable("The AI declined this task. It stayed open for a person.");
      }
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgentRunUnavailable("The AI returned an unreadable result. The task stayed open.");
  }
  const safe = safeAgentArtifact(parsed);
  if (!safe) {
    throw new AgentRunUnavailable("The AI result had no usable evidence. The task stayed open.");
  }
  return { ...safe, model: MODEL, runId: gateway.getRunId() ?? null };
};

export async function executeStewardAgentTask(input: {
  client: SupabaseClient;
  writer: SupabaseClient;
  organizationId: string;
  taskId: string;
  agentId: string;
  userId: string;
  callModel?: StewardAgentModelCall;
}): Promise<{ runId: string; status: string; note: string }> {
  const membership = await input.client
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (membership.error || (membership.data as Row | null)?.["status"] !== "active") {
    throw new AgentRunUnavailable("You are not an active member of this workspace.");
  }
  const taskRead = await input.client
    .from("steward_tasks")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("id", input.taskId)
    .maybeSingle();
  if (taskRead.error || !taskRead.data) {
    throw new AgentRunUnavailable("That task is unavailable, so no AI work started.");
  }
  const task = taskFromRow(taskRead.data as Row);
  if (task.assigneeKind !== "agent") {
    throw new AgentRunUnavailable("This task is not assigned to an AI teammate.");
  }
  const risk = classifyAgentTask(task);
  const idempotencyKey = `steward-agent:${input.organizationId}:${input.taskId}:v1`;
  const claim = await input.writer
    .from("steward_agent_runs")
    .insert({
      organization_id: input.organizationId,
      task_id: input.taskId,
      agent_id: input.agentId,
      requested_by: input.userId,
      idempotency_key: idempotencyKey,
      status: risk.executable ? "working" : "needs_approval",
      risk: risk.risk,
      evidence_refs: [],
      started_at: new Date().toISOString(),
      safe_error: risk.executable ? null : risk.because,
    })
    .select("id, status")
    .maybeSingle();
  if (claim.error) {
    if (claim.error.code === "23505") {
      const existing = await input.writer
        .from("steward_agent_runs")
        .select("id, status")
        .eq("organization_id", input.organizationId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing.data) {
        return {
          runId: String((existing.data as Row)["id"]),
          status: String((existing.data as Row)["status"]),
          note: "This task already has an agent run.",
        };
      }
    }
    const absent = /does not exist|schema cache|42P01|PGRST205/i.test(
      `${claim.error.code} ${claim.error.message}`,
    );
    throw new AgentRunUnavailable(
      absent
        ? "AI task execution is ready in code, but its workspace storage has not been applied yet."
        : claim.error.message,
    );
  }
  const runId = String((claim.data as Row)["id"]);
  if (!risk.executable) {
    await input.writer
      .from("steward_tasks")
      .update({ status: "needs_approval" })
      .eq("organization_id", input.organizationId)
      .eq("id", input.taskId)
      .eq("assignee_kind", "agent");
    return { runId, status: "needs_approval", note: risk.because };
  }
  try {
    const result = await (input.callModel ?? callStewardAgentModel)(task);
    const settledAt = new Date().toISOString();
    const settled = await input.writer
      .from("steward_agent_runs")
      .update({
        status: "completed",
        artifact: result.artifact,
        evidence_refs: result.evidenceRefs,
        model: result.model,
        provider_run_id: result.runId,
        settled_at: settledAt,
      })
      .eq("organization_id", input.organizationId)
      .eq("id", runId)
      .eq("status", "working")
      .select("id");
    if (settled.error || (settled.data ?? []).length !== 1) {
      throw new AgentRunUnavailable("The result could not be saved, so the task stayed open.");
    }
    const completed = await input.writer
      .from("steward_tasks")
      .update({ status: "complete", updated_at: settledAt })
      .eq("organization_id", input.organizationId)
      .eq("id", input.taskId)
      .eq("assignee_kind", "agent")
      .neq("status", "complete")
      .select("id");
    if (completed.error || (completed.data ?? []).length !== 1) {
      throw new AgentRunUnavailable("The result was saved, but task completion needs reconciliation.");
    }
    await input.writer.from("activities").insert({
      organization_id: input.organizationId,
      app_key: "steward",
      event_type: "task.completed",
      actor_user_id: null,
      entity_type: "task",
      entity_id: input.taskId,
      source_event_key: `steward:agent-run:${runId}:completed`,
      summary: `AI teammate completed “${task.title}” with saved evidence.`,
      occurred_at: settledAt,
      payload: {
        actor_is_agent: true,
        actor_kind: "agent",
        agent_id: input.agentId,
        agent_run_id: runId,
        evidence_refs: result.evidenceRefs,
        reversible: false,
      },
    });
    return { runId, status: "completed", note: "The internal result and its evidence were saved." };
  } catch (error) {
    const safe =
      error instanceof AgentRunUnavailable
        ? error.message
        : "The AI task failed safely. The task stayed open.";
    await input.writer
      .from("steward_agent_runs")
      .update({ status: "failed", safe_error: safe, settled_at: new Date().toISOString() })
      .eq("organization_id", input.organizationId)
      .eq("id", runId)
      .eq("status", "working");
    throw new AgentRunUnavailable(safe);
  }
}