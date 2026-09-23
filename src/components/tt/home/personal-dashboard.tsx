import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PersonDashboard } from "@/components/tt/steward/dashboard/person-dashboard";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { readStewardDashboard, type DashboardActivity } from "@/data/steward/dashboard-read";
import { useStewardActions } from "@/data/steward/use-steward-actions";
import { weeklyGoals } from "@/data/supabase/weekly-goals";
import type { StewardTask } from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** The signed-in person's operating view, shared by Home only. */
export function PersonalDashboard({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const queryKey = ["steward", "dashboard", identity.organizationId, identity.userId];
  const [confirmingGoal, setConfirmingGoal] = useState(false);

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
    <PersonDashboard
      read={read.data}
      scope="self"
      tasksHref="/modules/steward/tasks"
      activityHref="/modules/activity"
      onCompleteTask={handleCompleteTask}
      onConfirmGoal={handleConfirmGoal}
      confirmingGoal={confirmingGoal}
      onUndoActivity={handleUndo}
    />
  );
}