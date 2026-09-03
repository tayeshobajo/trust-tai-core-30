/**
 * Every write a Steward surface can make, with its dependencies handed in.
 *
 * The rule this module exists to keep: Steward records accountability, it does
 * not overwrite another room's truth. A meeting-only promise can be completed
 * here. Project work is completed in Projects. Agent work is completed only
 * when Paperclip reports it. Reassignment onto an agent asks Paperclip; it
 * never claims the agent accepted.
 *
 * Dependencies are parameters rather than imports so the whole chain, refusal,
 * write and audit entry, can be exercised end to end in a test.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { Commitment } from "@/domain/steward";
import type { StewardAgent, StewardFocus, StewardTask } from "@/domain/steward-accountability";

import {
  completeAuthority,
  dueDateAuthority,
  reassignAuthority,
  type StewardActor,
} from "./authority";

export interface AssignableTarget {
  key: string;
  name: string;
}

export interface StewardWriteDeps {
  setCommitmentStatus(id: string, status: Commitment["status"]): Promise<unknown>;
  setCommitmentOwner(id: string, owner: { name: string; email: string | null }): Promise<unknown>;
  setCommitmentDue(id: string, dueAt: string | null): Promise<unknown>;
  saveTaskState(input: {
    organizationId: string;
    userId: string;
    taskKey: string;
    focus?: StewardFocus | null;
    rank?: number | null;
    completedBy?: string | null;
    completedAt?: string | null;
    completionNote?: string | null;
  }): Promise<unknown>;
  recordActivity(event: Omit<ActivityEvent, "id">): Promise<unknown>;
  assignAgentTask(input: {
    organizationId: string;
    agentId: string;
    title: string;
    description: string;
    /** Trust Tai task key, used as idempotency key base for correlation. */
    sourceEntityId?: string | null;
    sourceEntityType?: string | null;
    sourceApp?: string | null;
  }): Promise<unknown>;
  now(): string;
}

export interface StewardWriter {
  identity: { organizationId: string; userId: string; name: string; canManage: boolean };
  deps: StewardWriteDeps;
}

/** Refusals carry the sentence a person should read, never a code. */
export class StewardRefusal extends Error {}

function actorOf(writer: StewardWriter): StewardActor {
  return { userId: writer.identity.userId, canManage: writer.identity.canManage };
}

async function audit(
  writer: StewardWriter,
  input: {
    name: ActivityEvent["name"];
    task: StewardTask;
    summary: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const at = writer.deps.now();
  try {
    await writer.deps.recordActivity({
      organizationId: writer.identity.organizationId,
      name: input.name,
      subject: { type: "task", id: input.task.id, label: input.task.title },
      summary: input.summary,
      payload: { steward_task_key: input.task.key, ...(input.payload ?? {}) },
      provenance: {
        appId: "steward",
        actor: { type: "user", id: writer.identity.userId, label: writer.identity.name },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });
  } catch {
    /* History is best effort. It must never block or undo a person's action. */
  }
}

/** An agent may only take work its published capability actually covers. */
export function agentCanTake(agent: StewardAgent, task: StewardTask): boolean {
  if (agent.capabilities.length === 0) return false;
  if (task.origin === "agent") return false;
  const haystack = `${task.title} ${task.sourceLabel}`.toLowerCase();
  return agent.capabilities.some((capability) => {
    const words = capability
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3);
    return words.some((word) => haystack.includes(word));
  });
}

export async function completeTask(
  writer: StewardWriter,
  { task, note }: { task: StewardTask; note: string },
): Promise<void> {
  const authority = completeAuthority(task, actorOf(writer));
  if (!authority.allowed) throw new StewardRefusal(authority.because ?? "That is not allowed.");

  await writer.deps.setCommitmentStatus(task.id, "kept");
  const at = writer.deps.now();
  try {
    await writer.deps.saveTaskState({
      organizationId: writer.identity.organizationId,
      userId: writer.identity.userId,
      taskKey: task.key,
      completedBy: writer.identity.name,
      completedAt: at,
      completionNote: note.trim() || null,
    });
  } catch {
    /* Steward's own framing table is optional; the promise is already kept. */
  }
  await audit(writer, {
    name: "task.completed",
    task,
    summary: `${writer.identity.name} completed “${task.title}”.`,
    ...(note.trim() ? { payload: { note: note.trim() } } : {}),
  });
}

export async function setTaskFocus(
  writer: StewardWriter,
  { task, focus }: { task: StewardTask; focus: StewardFocus },
): Promise<void> {
  await writer.deps.saveTaskState({
    organizationId: writer.identity.organizationId,
    userId: writer.identity.userId,
    taskKey: task.key,
    focus,
  });
  await audit(writer, { name: "task.updated", task, summary: `Focus set to ${focus}.` });
}

/** Reordering. The audit line says where it landed, not merely that it moved. */
export async function reprioritizeTask(
  writer: StewardWriter,
  { task, rank, aboveTitle }: { task: StewardTask; rank: number; aboveTitle?: string },
): Promise<void> {
  await writer.deps.saveTaskState({
    organizationId: writer.identity.organizationId,
    userId: writer.identity.userId,
    taskKey: task.key,
    rank,
  });
  await audit(writer, {
    name: "task.updated",
    task,
    summary: aboveTitle
      ? `${writer.identity.name} moved “${task.title}” above “${aboveTitle}”.`
      : `${writer.identity.name} reordered “${task.title}”.`,
    payload: { rank },
  });
}

export async function setTaskDue(
  writer: StewardWriter,
  { task, dueAt }: { task: StewardTask; dueAt: string | null },
): Promise<void> {
  const authority = dueDateAuthority(task, actorOf(writer));
  if (!authority.allowed) throw new StewardRefusal(authority.because ?? "That is not allowed.");
  await writer.deps.setCommitmentDue(task.id, dueAt);
  await audit(writer, {
    name: "task.updated",
    task,
    summary: dueAt ? `Due date set to ${dueAt.slice(0, 10)}.` : "Due date removed.",
  });
}

export async function reassignToPerson(
  writer: StewardWriter,
  { task, person }: { task: StewardTask; person: AssignableTarget },
): Promise<void> {
  const authority = reassignAuthority(task, actorOf(writer));
  if (!authority.allowed) throw new StewardRefusal(authority.because ?? "That is not allowed.");

  await writer.deps.setCommitmentOwner(task.id, {
    name: person.name,
    email: person.key.includes("@") ? person.key : null,
  });
  await audit(writer, {
    name: "task.assigned",
    task,
    summary: `${task.title} now carried by ${person.name}.`,
    payload: { owner_key: person.key, previous_owner_key: task.owner.key },
  });
}

export async function requestAgentAssignment(
  writer: StewardWriter,
  { task, agent }: { task: StewardTask; agent: StewardAgent },
): Promise<void> {
  const authority = reassignAuthority(task, actorOf(writer));
  if (!authority.allowed) throw new StewardRefusal(authority.because ?? "That is not allowed.");
  if (!agentCanTake(agent, task)) {
    throw new StewardRefusal(`${agent.name} has no published capability for this work.`);
  }

  await writer.deps.assignAgentTask({
    organizationId: writer.identity.organizationId,
    agentId: agent.paperclipAgentId,
    title: task.title,
    description: `${task.why} Source: ${task.sourceLabel}.`,
    sourceEntityId: task.key,
    sourceEntityType: task.origin === "commitment" ? "commitment" : "task",
    sourceApp: "steward",
  });
  await audit(writer, {
    name: "task.assigned",
    task,
    summary: `${task.title} sent to ${agent.name} in Paperclip.`,
    payload: { agent_id: agent.paperclipAgentId, previous_owner_key: task.owner.key },
  });
}
