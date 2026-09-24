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
import { normalizeRole } from "@/domain/access";
import { extractJsonObject, runtimeModelCaller } from "@/lib/intelligence-runtime.server";

type Row = Record<string, unknown>;

export class AgentRunUnavailable extends Error {}

export interface AgentRunOutcome {
  runId: string;
  status: string;
  note: string;
  /** Present only once the run completed. False means reconciliation is still owed. */
  taskCompleted?: boolean;
  feedRecorded?: boolean;
}

const EXECUTE_ROLES = new Set(["owner", "admin", "leadership", "project_lead", "client_support", "team_member", "member"]);

/**
 * Server execute authority. Read access is not execute access: view-only roles
 * never start AI work, and members may only run tasks they created or own.
 * Owners and admins may run any task in their workspace.
 */
export function agentExecutionAuthority(input: {
  role: string | null | undefined;
  userId: string;
  createdBy: string | null | undefined;
  ownerUserId: string | null | undefined;
}): { ok: true } | { ok: false; because: string } {
  const role = normalizeRole(input.role);
  if (!EXECUTE_ROLES.has(role)) {
    return { ok: false, because: "Your role can view this work but can't start AI tasks." };
  }
  if (role === "owner" || role === "admin") return { ok: true };
  if (input.createdBy === input.userId || input.ownerUserId === input.userId) return { ok: true };
  return { ok: false, because: "Only the person who created or owns this task can start AI work on it." };
}

/**
 * Completes the task and records the AI feed entry for a saved run. Idempotent:
 * safe to call again on retry, and it never calls the model.
 */
export async function recordAgentCompletion(
  writer: SupabaseClient,
  input: {
    organizationId: string;
    task: ManualTaskRecord;
    agentId: string;
    runId: string;
    evidenceRefs: string[];
    settledAt: string;
  },
): Promise<{ taskCompleted: boolean; feedRecorded: boolean; note: string }> {
  const completed = await writer
    .from("steward_tasks")
    .update({ status: "complete", updated_at: input.settledAt })
    .eq("organization_id", input.organizationId)
    .eq("id", input.task.id)
    .eq("assignee_kind", "agent")
    .neq("status", "complete")
    .select("id");
  let taskCompleted = !completed.error && (completed.data ?? []).length === 1;
  if (!taskCompleted && !completed.error) {
    const check = await writer
      .from("steward_tasks")
      .select("status")
      .eq("organization_id", input.organizationId)
      .eq("id", input.task.id)
      .maybeSingle();
    taskCompleted = (check.data as Row | null)?.["status"] === "complete";
  }
  const sourceEventKey = `steward:agent-run:${input.runId}:completed`;
  const prior = await writer
    .from("activities")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("source_event_key", sourceEventKey)
    .limit(1);
  let feedRecorded = !prior.error && (prior.data ?? []).length > 0;
  if (!feedRecorded) {
    const inserted = await writer.from("activities").insert({
      organization_id: input.organizationId,
      app_key: "steward",
      event_type: "task.completed",
      actor_user_id: null,
      entity_type: "task",
      entity_id: input.task.id,
      source_event_key: sourceEventKey,
      summary: `AI teammate completed “${input.task.title}” with saved evidence.`,
      occurred_at: input.settledAt,
      payload: {
        actor_is_agent: true,
        actor_kind: "agent",
        agent_id: input.agentId,
        agent_run_id: input.runId,
        evidence_refs: input.evidenceRefs,
        reversible: false,
      },
    });
    // 23505 means a concurrent retry already wrote the same entry.
    feedRecorded = !inserted.error || inserted.error.code === "23505";
  }
  const note =
    taskCompleted && feedRecorded
      ? "The result was saved, the task is complete and it shows in the AI feed."
      : taskCompleted
        ? "The result was saved and the task is complete, but the AI feed entry didn't save. Run again to retry the feed only."
        : feedRecorded
          ? "The result was saved and shows in the AI feed, but the task isn't marked complete yet. Run again to retry."
          : "The result was saved, but the task and AI feed still need updating. Run again to retry without redoing the work.";
  return { taskCompleted, feedRecorded, note };
}

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
}): Promise<AgentRunOutcome> {
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
  const authority = agentExecutionAuthority({
    role: (membership.data as Row | null)?.["role"] as string | null,
    userId: input.userId,
    createdBy: (taskRead.data as Row)["created_by"] as string | null,
    ownerUserId: (taskRead.data as Row)["owner_user_id"] as string | null,
  });
  if (!authority.ok) throw new AgentRunUnavailable(authority.because);
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
        .select("id, status, requested_by, evidence_refs, settled_at")
        .eq("organization_id", input.organizationId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing.data) {
        const row = existing.data as Row;
        const existingId = String(row["id"]);
        const status = String(row["status"]);
        // Recovery never reruns the model: it only reconciles the saved run.
        if (status === "completed" && row["requested_by"] === input.userId) {
          const rec = await recordAgentCompletion(input.writer, {
            organizationId: input.organizationId,
            task,
            agentId: input.agentId,
            runId: existingId,
            evidenceRefs: Array.isArray(row["evidence_refs"]) ? (row["evidence_refs"] as string[]) : [],
            settledAt: String(row["settled_at"] ?? new Date().toISOString()),
          });
          return {
            runId: existingId,
            status,
            taskCompleted: rec.taskCompleted,
            feedRecorded: rec.feedRecorded,
            note: rec.note,
          };
        }
        // A failed run never produced a saved result, so the requester may retry it.
        if (status === "failed" && row["requested_by"] === input.userId && risk.executable) {
          const reopened = await input.writer
            .from("steward_agent_runs")
            .update({ status: "working", safe_error: null, settled_at: null, started_at: new Date().toISOString() })
            .eq("organization_id", input.organizationId)
            .eq("id", existingId)
            .eq("status", "failed")
            .select("id");
          if (!reopened.error && (reopened.data ?? []).length === 1) {
            return runModelAndSettle(input, task, existingId);
          }
        }
        return { runId: existingId, status, note: "This task already has an AI run." };
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
  return runModelAndSettle(input, task, runId);
}

function safeFailureReason(error: unknown): string {
  if (error instanceof AgentRunUnavailable) return error.message;
  const name = error instanceof Error ? error.constructor.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message === "forbidden") return "AI access could not be verified for this workspace. The task stayed open.";
  if (name === "ProviderNotConfiguredError") return "The AI model isn't set up on the server yet. The task stayed open.";
  if (name === "ProviderCallFailedError") return "The AI model didn't respond successfully. The task stayed open; run it again.";
  return "The AI task failed safely. The task stayed open.";
}

async function runModelAndSettle(
  input: Parameters<typeof executeStewardAgentTask>[0],
  task: ManualTaskRecord,
  runId: string,
): Promise<AgentRunOutcome> {
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
    const rec = await recordAgentCompletion(input.writer, {
      organizationId: input.organizationId,
      task,
      agentId: input.agentId,
      runId,
      evidenceRefs: result.evidenceRefs,
      settledAt,
    });
    return {
      runId,
      status: "completed",
      taskCompleted: rec.taskCompleted,
      feedRecorded: rec.feedRecorded,
      note: rec.note,
    };
  } catch (error) {
    const safe = safeFailureReason(error);
    console.error("[steward-agent] run failed", {
      runId,
      kind: error instanceof Error ? error.constructor.name : typeof error,
      reason: safe,
      providerStatus: (error as { status?: number } | null)?.status ?? null,
    });
    await input.writer
      .from("steward_agent_runs")
      .update({ status: "failed", safe_error: safe, settled_at: new Date().toISOString() })
      .eq("organization_id", input.organizationId)
      .eq("id", runId)
      .eq("status", "working");
    throw new AgentRunUnavailable(safe);
  }
}
