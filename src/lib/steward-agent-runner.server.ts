import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyAgentTask, safeAgentArtifact } from "@/domain/steward-agent-execution";
import type { ManualTaskRecord } from "@/domain/steward-accountability";
import {
  linkedProspectId,
  MAX_AGENT_PEOPLE,
  toPeopleEvidence,
  validatePeopleUse,
  type AgentPersonEvidence,
  type AgentPersonRow,
} from "@/domain/steward-agent-people";
import {
  toProspectContext,
  validateProspectRefs,
  type ProspectContext,
} from "@/domain/steward-agent-prospect-context";
import { extractJsonObject, runtimeModelCaller } from "@/lib/intelligence-runtime.server";

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
    ...(typeof row["correlation_id"] === "string" ? { correlationId: row["correlation_id"] } : {}),
    ...(typeof row["source_app"] === "string" ? { sourceApp: row["source_app"] } : {}),
    ...(typeof row["source_entity_type"] === "string"
      ? { sourceEntityType: row["source_entity_type"] }
      : {}),
    ...(typeof row["source_entity_id"] === "string"
      ? { sourceEntityId: row["source_entity_id"] }
      : {}),
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
  };
}

export type StewardAgentModelCall = (
  task: ManualTaskRecord,
  people?: AgentPersonEvidence[],
  prospect?: ProspectContext | null,
) => Promise<{
  artifact: string;
  evidenceRefs: string[];
  peopleNamed?: string[];
  model: string;
  runId: string | null;
}>;

/** Saved Scout People for the task's exactly-linked prospect, read as the caller (RLS). */
export async function loadAgentPeople(
  client: SupabaseClient,
  organizationId: string,
  task: ManualTaskRecord,
): Promise<AgentPersonEvidence[]> {
  const prospectId = linkedProspectId(task);
  if (!prospectId) return [];
  const { data, error } = await client
    .from("scout_people")
    .select(
      "id, full_name, title, company_name, email_status, work_email, buying_role, why_this_person",
    )
    .eq("organization_id", organizationId)
    .eq("prospect_id", prospectId)
    .order("discovered_at", { ascending: true })
    .limit(MAX_AGENT_PEOPLE);
  if (error) return [];
  return toPeopleEvidence((data ?? []) as AgentPersonRow[]);
}

/** The exactly-linked Scout profile's recorded facts, read as the caller (RLS). */
export async function loadAgentProspect(
  client: SupabaseClient,
  organizationId: string,
  task: ManualTaskRecord,
): Promise<ProspectContext | null> {
  const prospectId = linkedProspectId(task);
  if (!prospectId) return null;
  const { data, error } = await client
    .from("prospects")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", prospectId)
    .maybeSingle();
  if (error) return null;
  return toProspectContext((data ?? null) as Row | null);
}

export const callStewardAgentModel: StewardAgentModelCall = async (task, people = [], prospect = null) => {
  const token = task.correlationId?.startsWith("runtime-token:")
    ? task.correlationId.slice("runtime-token:".length)
    : "";
  if (!token) {
    throw new AgentRunUnavailable("AI access could not be verified, so the task stayed open.");
  }
  const call = await runtimeModelCaller({
    token,
    organizationId: task.organizationId,
    room: "steward",
    purpose: "bounded_agent_task",
  });
  const response = await call({
    model: MODEL,
    instructions:
      "You are a bounded internal preparation agent. Use only supplied context. Never send, publish, approve, promise, price, change scope or dates, or claim unsupported facts. Return JSON only with artifact, evidence_refs and people_named. Every claim must be grounded in a supplied evidence ref. When people are supplied, refer to them by their exact saved name and title and cite their person ref; list every person you name in people_named. Never name anyone not supplied. If no people are supplied and the task asks about people, say no saved Scout people exist yet. When a scout_profile is supplied, cite its fact refs for company facts; for anything listed under unknown, say it is not recorded.",
    input: `Return json only. ${JSON.stringify({
      title: task.title,
      notes: task.notes ?? null,
      acceptance_criteria: task.acceptanceCriteria,
      context: task.contextLinks.map((link, index) => ({
        ref: `context:${index + 1}`,
        label: link.label,
        url: link.url,
      })),
      scout_profile: prospect
        ? { ref: prospect.ref, name: prospect.name, facts: prospect.facts, unknown: prospect.unknown }
        : null,
      scout_people: people.map((p) => ({
        ref: p.ref,
        name: p.name,
        title: p.title,
        company: p.company,
        work_email: p.email,
        buying_role: p.buyingRole,
        why: p.why,
      })),
    })}`,
    webSearch: false,
    responseFormat: {
      type: "json_schema",
      name: "steward_artifact",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["artifact", "evidence_refs", "people_named"],
        properties: {
          artifact: { type: "string" },
          evidence_refs: { type: "array", items: { type: "string" } },
          people_named: { type: "array", items: { type: "string" } },
        },
      },
    },
  });
  let parsed: unknown;
  try {
    parsed = extractJsonObject(response.raw);
  } catch {
    throw new AgentRunUnavailable("The AI returned an unreadable result. The task stayed open.");
  }
  const safe = safeAgentArtifact(parsed);
  if (!safe) {
    throw new AgentRunUnavailable("The AI result had no usable evidence. The task stayed open.");
  }
  const named = (parsed as { people_named?: unknown }).people_named;
  const peopleNamed = Array.isArray(named) ? named.filter((n): n is string => typeof n === "string") : [];
  return { ...safe, peopleNamed, model: response.model, runId: null };
};

export async function executeStewardAgentTask(input: {
  client: SupabaseClient;
  writer: SupabaseClient;
  organizationId: string;
  taskId: string;
  agentId: string;
  userId: string;
  token: string;
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
    const runtimeTask: ManualTaskRecord = { ...task, correlationId: `runtime-token:${input.token}` };
    const people = await loadAgentPeople(input.client, input.organizationId, task);
    const prospect = await loadAgentProspect(input.client, input.organizationId, task);
    const result = await (input.callModel ?? callStewardAgentModel)(runtimeTask, people, prospect);
    const prospectCheck = validateProspectRefs(result.evidenceRefs, prospect);
    if (!prospectCheck.ok) throw new AgentRunUnavailable(prospectCheck.because);
    const peopleCheck = validatePeopleUse({
      artifact: result.artifact,
      evidenceRefs: result.evidenceRefs,
      peopleNamed: result.peopleNamed ?? [],
      people,
    });
    if (!peopleCheck.ok) throw new AgentRunUnavailable(peopleCheck.because);
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