/**
 * The per-person Steward dashboard body ("Your dashboard" / My Week).
 *
 * One component, one scope derivation: self when the viewer is looking at
 * their own week, team when looking at a teammate's. Self sees full detail
 * and every action affordance; team sees status only, no titles, no confirm,
 * no checkbox action and no undo. Every number traces back to a real row from
 * src/domain/steward-dashboard-stats.ts; an empty source renders an honest
 * zero rather than inventing one.
 */

import { useMemo } from "react";

import { GoalHeroBand } from "@/components/tt/steward/goal-hero-band";
import { ActivityFeed } from "@/components/tt/steward/dashboard/activity-feed";
import { BlockersStrip } from "@/components/tt/steward/dashboard/blockers-strip";
import { DashboardHeader } from "@/components/tt/steward/dashboard/dashboard-header";
import { MyTasksPanel } from "@/components/tt/steward/dashboard/my-tasks-panel";
import { StatRow } from "@/components/tt/steward/dashboard/stat-row";
import type { DashboardActivity, StewardDashboardRead } from "@/data/steward/dashboard-read";
import {
  computeMinutesSaved,
  computeStreakDays,
  computeTasksCompleted,
  computeXp,
  levelForXp,
} from "@/domain/steward-dashboard-stats";
import { computeWeeklyGoalProgress } from "@/domain/steward-weekly-goal";
import type { StewardTask } from "@/domain/steward-accountability";

export type DashboardScope = "self" | "team";

export function PersonDashboard({
  read,
  scope,
  tasksHref,
  activityHref,
  onCompleteTask,
  onConfirmGoal,
  confirmingGoal,
  onUndoActivity,
  onCreateTask,
  onReassignTask,
  completingTaskKey,
}: {
  read: StewardDashboardRead;
  scope: DashboardScope;
  tasksHref: string;
  activityHref: string;
  onCompleteTask: (task: StewardTask) => void;
  onConfirmGoal: () => void;
  confirmingGoal: boolean;
  onUndoActivity: (activity: DashboardActivity) => void;
  onCreateTask?: () => void;
  onReassignTask?: (task: StewardTask) => void;
  completingTaskKey?: string | null;
}) {
  const streakDays = useMemo(
    () => computeStreakDays(read.activities.map((event) => event.occurredAt), read.now),
    [read.activities, read.now],
  );

  const xp = useMemo(
    () => computeXp(read.activities.map((event) => ({ eventType: event.eventType }))),
    [read.activities],
  );
  const level = useMemo(() => levelForXp(xp), [xp]);

  const tasksCompleted = useMemo(
    () => computeTasksCompleted(read.tasks, read.identity.userId),
    [read.tasks, read.identity.userId],
  );

  const minutesSaved = useMemo(
    () =>
      computeMinutesSaved(
        read.activities.map((event) => ({
          actorIsAgent: event.actorIsAgent,
          ...(event.minutesSaved !== undefined ? { minutesSaved: event.minutesSaved } : {}),
        })),
      ),
    [read.activities],
  );

  const goalProgress = useMemo(
    () => (read.weeklyGoal ? computeWeeklyGoalProgress(read.weeklyGoal, read.tasks) : null),
    [read.weeklyGoal, read.tasks],
  );

  const linkedTasks = useMemo(() => {
    if (!read.weeklyGoal) return [];
    const byKey = new Map(read.tasks.map((task) => [task.key, task] as const));
    const byId = new Map(read.tasks.map((task) => [task.id, task] as const));
    return read.weeklyGoal.linkedTaskIds
      .map((linkedId) => byKey.get(linkedId) ?? byId.get(linkedId))
      .filter((task): task is StewardTask => Boolean(task));
  }, [read.weeklyGoal, read.tasks]);

  const clearedCount = goalProgress?.agentCleared ?? 0;

  return (
    <div className="space-y-3 pb-6">
      <DashboardHeader identity={read.identity} now={read.now} scope={scope} />

      <div className="space-y-2">
        <GoalHeroBand
          goal={read.weeklyGoal}
          progress={goalProgress}
          onConfirm={onConfirmGoal}
          pending={confirmingGoal}
          canConfirm={scope === "self"}
        />
        {scope === "self" && linkedTasks.length > 0 ? (
          <ul className="-mt-12 ml-[132px] mr-[190px] hidden flex-wrap gap-2 pb-2 md:flex">
            {linkedTasks.map((task) => (
              <li
                key={task.key}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground"
              >
                {task.state === "complete" ? "✓ " : ""}
                {task.title}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <StatRow
        streakDays={streakDays}
        level={level}
        tasksCompleted={tasksCompleted}
        minutesSaved={minutesSaved}
      />

      <div className="grid items-start gap-3 xl:grid-cols-[1.08fr_1fr]">
        <MyTasksPanel
          tasks={read.tasks}
          now={read.now}
          scope={scope}
          onToggle={onCompleteTask}
          onCreate={onCreateTask}
          onReassign={onReassignTask}
          completingTaskKey={completingTaskKey}
          viewAllHref={tasksHref}
        />

        <ActivityFeed
          activities={read.activities}
          now={read.now}
          scope={scope}
          clearedCount={clearedCount}
          minutesSaved={minutesSaved}
          onUndo={onUndoActivity}
          viewAllHref={activityHref}
        />
      </div>

      <BlockersStrip tasks={read.tasks} scope={scope} />
    </div>
  );
}
