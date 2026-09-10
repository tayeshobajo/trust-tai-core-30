/**
 * Steward's writes, wired to the live workspace.
 *
 * The rules live in `authority.ts` and the write chain lives in `actions.ts`;
 * this hook only supplies the real services and turns a refusal into something
 * a person can read. A refusal never reports success.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabaseActivity } from "@/data/supabase/activities";
import { stewardService } from "@/data/supabase/steward-service";
import { stewardTaskState } from "@/data/supabase/steward-task-state";
import type { StewardAgent, StewardFocus, StewardTask } from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

import type { AssignablePerson } from "@/components/tt/steward/reassign-picker";

import {
  agentCanTake,
  completeTask,
  reassignToPerson,
  reprioritizeTask,
  requestAgentAssignment,
  setTaskDue,
  setTaskFocus,
  type StewardWriteDeps,
  type StewardWriter,
} from "./actions";

export { agentCanTake } from "./actions";

const liveDeps: StewardWriteDeps = {
  setCommitmentStatus: (id, status) => stewardService.setStatus(id, status),
  setCommitmentOwner: (id, owner) => stewardService.setOwner(id, owner),
  setCommitmentDue: (id, dueAt) => stewardService.setDue(id, dueAt),
  saveTaskState: (input) => stewardTaskState.save(input),
  recordActivity: (event) => supabaseActivity.record(event),
  assignAgentTask: async (input) => {
    const { assignStewardAgentTask } = await import("@/data/steward-agents.functions");
    return assignStewardAgentTask({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        title: input.title,
        description: input.description,
        sourceEntityId: input.sourceEntityId ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceApp: input.sourceApp ?? "steward",
      },
    });
  },
  now: () => new Date().toISOString(),
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
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

  const writer: StewardWriter = {
    identity: {
      organizationId: identity.organizationId,
      userId: identity.userId,
      name: identity.name,
      canManage: identity.canManage,
    },
    deps: liveDeps,
  };

  const complete = useMutation({
    mutationFn: (input: { task: StewardTask; note: string }) => completeTask(writer, input),
    onSuccess: () => {
      toast.success("Recorded as complete.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error("Not recorded", { description: message(error, "That could not be recorded.") }),
  });

  const focus = useMutation({
    mutationFn: (input: { task: StewardTask; focus: StewardFocus }) => setTaskFocus(writer, input),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error("Focus not saved", { description: message(error, "That could not be saved.") }),
  });

  const rank = useMutation({
    mutationFn: (input: { task: StewardTask; rank: number; aboveTitle?: string }) =>
      reprioritizeTask(writer, input),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error("Order not saved", { description: message(error, "That could not be saved.") }),
  });

  const due = useMutation({
    mutationFn: (input: { task: StewardTask; dueAt: string | null }) => setTaskDue(writer, input),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error("Date not saved", { description: message(error, "That could not be saved.") }),
  });

  const person = useMutation({
    mutationFn: (input: { task: StewardTask; person: AssignablePerson }) =>
      reassignToPerson(writer, input),
    onSuccess: () => {
      toast.success("Owner updated.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error("Not reassigned", {
        description: message(error, "That could not be reassigned."),
      }),
  });

  const agent = useMutation({
    mutationFn: (input: { task: StewardTask; agent: StewardAgent }) =>
      requestAgentAssignment(writer, input),
    onSuccess: () => {
      toast.success("Sent to Paperclip. Steward will show progress as it reports back.");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error("Not assigned", {
        description: message(error, "Paperclip did not accept that task."),
      }),
  });

  return {
    complete: (task: StewardTask, note: string) => complete.mutate({ task, note }),
    setFocus: (task: StewardTask, value: StewardFocus) => focus.mutate({ task, focus: value }),
    setRank: (task: StewardTask, value: number, aboveTitle?: string) =>
      rank.mutateAsync({ task, rank: value, ...(aboveTitle ? { aboveTitle } : {}) }),
    setDue: (task: StewardTask, dueAt: string | null) => due.mutate({ task, dueAt }),
    reassignToPerson: (task: StewardTask, target: AssignablePerson) =>
      person.mutate({ task, person: target }),
    requestAgentAssignment: (task: StewardTask, target: StewardAgent) =>
      agent.mutate({ task, agent: target }),
    eligibleAgent: agentCanTake,
    pending:
      complete.isPending || person.isPending || agent.isPending || due.isPending || rank.isPending,
  };
}
