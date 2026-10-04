import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useNavigate } from "@tanstack/react-router";

import { PersonDashboard } from "@/components/tt/steward/dashboard/person-dashboard";
import { ReassignPicker } from "@/components/tt/steward/reassign-picker";
import { TaskDetailPanel } from "@/components/tt/steward/task-detail";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { readStewardDashboard, type DashboardActivity } from "@/data/steward/dashboard-read";
import { reassignAuthority } from "@/data/steward/authority";
import { useStewardActions } from "@/data/steward/use-steward-actions";
import { weeklyGoals } from "@/data/supabase/weekly-goals";
import type { StewardTask } from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** The signed-in person's operating view, shared by Home only. */
export function PersonalDashboard({ identity }: { identity: WorkspaceIdentity }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = ["steward", "dashboard", identity.organizationId, identity.userId];
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

  function handleCompleteTask(task: StewardTask): void {
    actions.complete(task, "");
  }

  function handleUndo(activity: DashboardActivity): void {
    actions.undoAgentCleared(activity.id, activity.summary);
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
      <Link
        to="/modules/steward/board"
        className="mb-4 inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-royal"
      >
        Open task board
      </Link>
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
        onCreateTask={() =>
          void navigate({ to: "/modules/steward/board", search: { scope: "personal" } })
        }
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
