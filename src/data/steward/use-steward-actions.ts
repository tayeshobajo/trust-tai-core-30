/**
 * Every write a Steward surface can make.
 *
 * The rule the whole hook exists to keep: Steward records accountability, not
 * other rooms' truth. A meeting-only commitment can be completed here. Project
 * work is completed in Projects. Agent work is completed only when Paperclip
 * says so. Reassignment onto an agent asks Paperclip; it never claims it.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabaseActivity } from "@/data/supabase/activities";
import { stewardService } from "@/data/supabase/steward-service";
import { stewardTaskState } from "@/data/supabase/steward-task-state";
import type {
  StewardAgent,
  StewardFocus,
  StewardTask,
} from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

import type { AssignablePerson } from "@/components/tt/steward/reassign-picker";

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

export function useStewardActions({
  identity,
  queryKey,
}: {
  identity: WorkspaceIdentity;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  async function log(input: {
    name: Parameters<typeof supabaseActivity.record>[0]["name"];
    task: StewardTask;
    summary: string;
    payload?: Record<string, unknown>;
  }) {
    try {
      await supabaseActivity.record({
        organizationId: identity.organizationId,
        name: input.name,
        subject: { type: "task", id: input.task.id, label: input.task.title },
        summary: input.summary,
        payload: { steward_task_key: input.task.key, ...(input.payload ?? {}) },
        provenance: {
          appId: "steward",
          actor: { type: "user", id: identity.userId, label: identity.name },
          observedAt: new Date().toISOString(),
          confidence: "observed",
        },
        occurredAt: new Date().toISOString(),
      });
    } catch {
      /* History is best effort. It must never block a person's action. */
    }
  }

  const complete = useMutation({
    mutationFn: async ({ task, note }: { task: StewardTask; note: string }) => {
      if (!identity.canManage && task.owner.userId !== identity.userId) {
        throw new Error("You do not have authority to complete this task.");
      }
      if (task.completionPath !== "steward") {
        throw new Error(
          task.completionBecause ?? "This task is completed in the room that owns it.",
        );
      }
      await stewardService.setStatus(task.id, "kept");
      await stewardTaskState
        .save({
          organizationId: identity.organizationId,
          userId: identity.userId,
          taskKey: task.key,
          completedBy: identity.name,
          completedAt: new Date().toISOString(),
          completionNote: note.trim() || null,
        })
        .catch(() => null);
      await log({
        name: "task.completed",
        task,
        summary: `${identity.name} completed “${task.title}”.`,
        ...(note.trim() ? { payload: { note: note.trim() } } : {}),
      });
    },
    onSuccess: () => {
      toast.success("Recorded as complete.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That could not be recorded."),
  });

  const setFocus = useMutation({
    mutationFn: async ({ task, focus }: { task: StewardTask; focus: StewardFocus }) => {
      await stewardTaskState.save({
        organizationId: identity.organizationId,
        userId: identity.userId,
        taskKey: task.key,
        focus,
      });
      await log({ name: "task.updated", task, summary: `Focus set to ${focus}.` });
    },
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Focus could not be saved."),
  });

  const setRank = useMutation({
    mutationFn: async ({ task, rank }: { task: StewardTask; rank: number }) => {
      await stewardTaskState.save({
        organizationId: identity.organizationId,
        userId: identity.userId,
        taskKey: task.key,
        rank,
      });
    },
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Order could not be saved."),
  });

  const setDue = useMutation({
    mutationFn: async ({ task, due }: { task: StewardTask; due: string | null }) => {
      if (task.origin !== "commitment") {
        throw new Error("Dates on delivery work are set in the room that owns it.");
      }
      await stewardService.setDue(task.id, due);
      await log({ name: "task.updated", task, summary: `Due date set to ${due ?? "none"}.` });
    },
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That date could not be saved."),
  });

  const reassignToPerson = useMutation({
    mutationFn: async ({ task, person }: { task: StewardTask; person: AssignablePerson }) => {
      if (!identity.canManage) throw new Error("Only an owner or admin can reassign work.");
      if (task.origin !== "commitment") {
        throw new Error(
          "This task is owned by another room. Change its owner there and Steward will follow.",
        );
      }
      await stewardService.setOwner(task.id, {
        name: person.name,
        email: person.key.includes("@") ? person.key : null,
      });
      await log({
        name: "task.assigned",
        task,
        summary: `${task.title} now carried by ${person.name}.`,
        payload: { owner_key: person.key },
      });
    },
    onSuccess: () => {
      toast.success("Owner updated.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That could not be reassigned."),
  });

  const requestAgentAssignment = useMutation({
    mutationFn: async ({ task, agent }: { task: StewardTask; agent: StewardAgent }) => {
      if (!identity.canManage) throw new Error("Only an owner or admin can assign agent work.");
      if (!agentCanTake(agent, task)) {
        throw new Error(`${agent.name} has no published capability for this work.`);
      }
      const { assignStewardAgentTask } = await import("@/data/steward-agents.functions");
      await assignStewardAgentTask({
        data: {
          organizationId: identity.organizationId,
          agentId: agent.paperclipAgentId,
          title: task.title,
          description: `${task.why} Source: ${task.sourceLabel}.`,
        },
      });
      await log({
        name: "task.assigned",
        task,
        summary: `${task.title} sent to ${agent.name} in Paperclip.`,
        payload: { agent_id: agent.paperclipAgentId },
      });
    },
    onSuccess: () => {
      toast.success("Sent to Paperclip. Steward will show progress as it reports back.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Paperclip did not accept that task."),
  });

  return {
    complete: (task: StewardTask, note: string) => complete.mutate({ task, note }),
    setFocus: (task: StewardTask, focus: StewardFocus) => setFocus.mutate({ task, focus }),
    setRank: (task: StewardTask, rank: number) => setRank.mutateAsync({ task, rank }),
    setDue: (task: StewardTask, due: string | null) => setDue.mutate({ task, due }),
    reassignToPerson: (task: StewardTask, person: AssignablePerson) =>
      reassignToPerson.mutate({ task, person }),
    requestAgentAssignment: (task: StewardTask, agent: StewardAgent) =>
      requestAgentAssignment.mutate({ task, agent }),
    eligibleAgent: agentCanTake,
  };
}
