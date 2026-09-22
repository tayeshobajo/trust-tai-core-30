/**
 * Steward, Your dashboard (self scope).
 *
 * A person's own week: goal, streak, level, tasks completed, time saved,
 * their tasks, AI teammate activity and blockers. Every number comes from
 * src/data/steward/dashboard-read.ts, which reads real rows only, so an
 * unprovisioned or empty workspace renders honest empties rather than
 * crashing. See src/routes/modules.steward.people.$userId.tsx for the
 * status-only team view of the same component.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { PersonDashboard } from "@/components/tt/steward/dashboard/person-dashboard";
import { StewardTabs } from "@/components/tt/steward/steward-tabs";
import { StewardUnavailable } from "@/components/tt/steward/unavailable";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { readStewardDashboard, type DashboardActivity } from "@/data/steward/dashboard-read";
import { useStewardActions } from "@/data/steward/use-steward-actions";
import { weeklyGoals } from "@/data/supabase/weekly-goals";
import type { StewardTask } from "@/domain/steward-accountability";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Steward · Your dashboard · Trust Tai OS";
const DESCRIPTION = "Your goal, your tasks, and what an AI teammate cleared for you this week.";

export const Route = createFileRoute("/modules/steward/dashboard")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DashboardRoute,
});

function DashboardRoute() {
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <AppShell identity={identity}>
          <YourDashboard identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function YourDashboard({ identity }: { identity: WorkspaceIdentity }) {
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

  if (read.isError) {
    return (
      <div className="space-y-8">
        <StewardTabs active="dashboard" />
        <StewardUnavailable error={read.error} />
      </div>
    );
  }

  if (!read.data) {
    return (
      <div className="space-y-8">
        <StewardTabs active="dashboard" />
        <p className="text-sm text-muted-foreground">Loading your dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <StewardTabs active="dashboard" />
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
    </div>
  );
}
