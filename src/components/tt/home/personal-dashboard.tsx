import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  CreateTaskDrawer,
  type CreateManualTaskInput,
} from "@/components/tt/steward/create-task-drawer";
import { PersonDashboard } from "@/components/tt/steward/dashboard/person-dashboard";
import { ReassignPicker } from "@/components/tt/steward/reassign-picker";
import { TaskDetailPanel } from "@/components/tt/steward/task-detail";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { readStewardDashboard, type DashboardActivity } from "@/data/steward/dashboard-read";
import { reassignAuthority } from "@/data/steward/authority";
import { useStewardActions } from "@/data/steward/use-steward-actions";
import { stewardTasks } from "@/data/supabase/steward-tasks";
import { weeklyGoals } from "@/data/supabase/weekly-goals";
import type { StewardTask } from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** The signed-in person's operating view, shared by Home only. */
export function PersonalDashboard({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const queryKey = ["steward", "dashboard", identity.organizationId, identity.userId];
  const [confirmingGoal, setConfirmingGoal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
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

  function handleCompleteTask(task: StewardTask): void {
    actions.complete(task, "");
  }

  function handleUndo(activity: DashboardActivity): void {
    actions.undoAgentCleared(activity.id, activity.summary);
  }

  async function handleCreate(input: CreateManualTaskInput): Promise<void> {
    setCreatingTask(true);
    try {
      await stewardTasks.create({
        organizationId: identity.organizationId,
        createdBy: identity.userId,
        title: input.title,
        clientId: input.clientId ?? null,
        clientLabel: input.clientLabel ?? null,
        projectId: input.projectId ?? null,
        projectLabel: input.projectLabel ?? null,
        dueAt: input.dueAt ?? null,
        ownerUserId: input.ownerUserId ?? identity.userId,
        ownerLabel: input.ownerLabel ?? identity.name,
        priority: input.priority,
        assigneeKind: "human",
        aiMode: null,
        status: input.status,
        subtasks: input.subtasks,
        acceptanceCriteria: input.acceptanceCriteria,
        contextLinks: input.contextLinks,
        notes: input.notes ?? null,
      });
      toast.success(input.status === "draft" ? "Task draft saved." : "Task created.");
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      toast.error("Task not saved", {
        description: error instanceof Error ? error.message : "The task could not be saved.",
      });
    } finally {
      setCreatingTask(false);
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
    <PersonDashboard
      read={read.data}
      scope="self"
      tasksHref="/modules/steward/tasks"
      activityHref="/modules/activity"
      onCompleteTask={handleCompleteTask}
      onConfirmGoal={handleConfirmGoal}
      confirmingGoal={confirmingGoal}
      onUndoActivity={handleUndo}
      actor={{ userId: identity.userId, canManage: identity.canManage }}
      taskStorageAvailable={read.data.taskStorageAvailable}
      completingTaskKey={actions.completingTaskKey}
      onCreateTask={() => setCreating(true)}
      onReassignTask={setReassigning}
      onOpenTask={setOpenTask}
    />
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
      refusal={reassigning ? reassignAuthority(reassigning, { userId: identity.userId, canManage: identity.canManage }).because : null}
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
    <CreateTaskDrawer
      open={creating}
      onClose={() => setCreating(false)}
      identity={identity}
      clients={Array.from(new Map(read.data.tasks.filter((task) => task.companyLabel).map((task) => [task.companyLabel!, task.companyLabel!])).entries()).map(([id, label]) => ({ id, label }))}
      projects={Array.from(new Map(read.data.tasks.filter((task) => task.projectId && task.projectName).map((task) => [task.projectId!, task.projectName!])).entries()).map(([id, label]) => ({ id, label }))}
      people={read.data.people}
      onCreate={(input) => handleCreate(input)}
      pending={creatingTask}
      allowAgentCreate={false}
    />
    </>
  );
}