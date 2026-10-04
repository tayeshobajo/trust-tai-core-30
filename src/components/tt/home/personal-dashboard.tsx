import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DailyHome } from "./daily-home";
import { TaskEditor } from "@/components/tt/steward/business-task-board";
import { cmdTasks } from "@/data/supabase/cmd-tasks";
import type { BoardTask } from "@/domain/cmd-tasks";
import { ReassignPicker } from "@/components/tt/steward/reassign-picker";
import { TaskDetailPanel } from "@/components/tt/steward/task-detail";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { readStewardDashboard } from "@/data/steward/dashboard-read";
import { reassignAuthority } from "@/data/steward/authority";
import { useStewardActions } from "@/data/steward/use-steward-actions";
import { weeklyGoals } from "@/data/supabase/weekly-goals";
import type { StewardTask } from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** The signed-in person's operating view, shared by Home only. */
export function PersonalDashboard({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const queryKey = ["steward", "dashboard", identity.organizationId, identity.userId];
  const [newTaskKey, setNewTaskKey] = useState<string | null>(null);
  const [boardTask, setBoardTask] = useState<BoardTask | null>(null);
  const [confirmingGoal, setConfirmingGoal] = useState(false);
  const [reassigning, setReassigning] = useState<StewardTask | null>(null);
  const [openTask, setOpenTask] = useState<StewardTask | null>(null);

  const read = useQuery({
    queryKey,
    queryFn: () =>
      readStewardDashboard(identity.organizationId, identity.userId, identity.name, identity.role),
  });

  const actions = useStewardActions({ identity, queryKey });

  async function handleConfirmGoal(): Promise<void> {
    const goal = read.data?.weeklyGoal;
    if (!goal) return;
    setConfirmingGoal(true);
    try {
      await weeklyGoals.confirm(goal.id);
      toast.success("Goal confirmed. It is yours for the week.");
      void queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not confirm the goal.");
    } finally {
      setConfirmingGoal(false);
    }
  }

  if (read.isError) return <StewardUnavailable error={read.error} />;

  if (!read.data) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-5">
        <p className="text-sm text-muted-foreground">Loading your dashboard.</p>
      </div>
    );
  }

  return (
    <>
      <DailyHome
        identity={identity}
        read={read.data}
        onConfirmGoal={handleConfirmGoal}
        confirmingGoal={confirmingGoal}
        onCreate={() => setNewTaskKey(`cmd-board:${crypto.randomUUID()}`)}
        onOpenLegacy={setOpenTask}
        onOpenBoard={setBoardTask}
      />
      {boardTask || newTaskKey ? (
        <TaskEditor
          key={boardTask?.id ?? newTaskKey}
          task={boardTask}
          scope={boardTask?.task_visibility ?? "personal"}
          identity={identity}
          tasks={
            queryClient.getQueryData<{ tasks: BoardTask[] }>([
              "cmd-tasks",
              identity.organizationId,
              identity.userId,
              boardTask?.task_visibility ?? "personal",
            ])?.tasks ?? (boardTask ? [boardTask] : [])
          }
          people={read.data.people.map((p) => ({ userId: p.userId, name: p.name }))}
          onClose={() => {
            setBoardTask(null);
            setNewTaskKey(null);
          }}
          onSave={async (input) => {
            if (boardTask) await cmdTasks.update(boardTask, input);
            else if (newTaskKey)
              await cmdTasks.create(identity.organizationId, "personal", newTaskKey, input);
            await queryClient.invalidateQueries({
              queryKey: ["cmd-tasks", identity.organizationId, identity.userId],
            });
            setBoardTask(null);
            setNewTaskKey(null);
          }}
        />
      ) : null}
      <TaskDetailPanel
        task={openTask}
        actor={{ userId: identity.userId, canManage: identity.canManage }}
        onClose={() => setOpenTask(null)}
        onComplete={(note) => {
          if (openTask) actions.complete(openTask, note);
          setOpenTask(null);
        }}
        onReassign={() => {
          setReassigning(openTask);
          setOpenTask(null);
        }}
        onFocus={(focus) => openTask && actions.setFocus(openTask, focus)}
        onDue={(due) => openTask && actions.setDue(openTask, due)}
      />
      <ReassignPicker
        open={Boolean(reassigning)}
        task={reassigning}
        people={read.data.people}
        agents={read.data.agents.agents}
        eligibleAgent={actions.eligibleAgent}
        refusal={
          reassigning
            ? reassignAuthority(reassigning, {
                userId: identity.userId,
                canManage: identity.canManage,
              }).because
            : null
        }
        onClose={() => setReassigning(null)}
        onAssignPerson={(person) => {
          if (reassigning) actions.reassignToPerson(reassigning, person);
          setReassigning(null);
        }}
        onAssignAgent={(agent) => {
          if (reassigning) actions.requestAgentAssignment(reassigning, agent);
          setReassigning(null);
        }}
      />
    </>
  );
}
