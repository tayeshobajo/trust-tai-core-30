/**
 * Per-task timeline built only from records that exist: the task row, its
 * activities and its agent runs. Missing history is "Not recorded", never zero.
 */

export type TimelineStage = "pending" | "in_progress" | "needs_approval" | "completed" | "failed";

export interface TimelineStep {
  stage: TimelineStage;
  at: string | null;
  actor: string;
  note?: string;
}

export interface TaskTimeline {
  taskId: string;
  title: string;
  current: TimelineStage;
  ownerLabel: string;
  steps: TimelineStep[];
  lastAt: string;
}

export interface TimelineTaskInput {
  id: string;
  title: string;
  status: string;
  assigneeKind: "human" | "agent";
  ownerLabel?: string;
  createdByLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineActivityInput {
  entityId: string;
  eventType: string;
  occurredAt: string;
  actorLabel?: string;
  actorIsAgent: boolean;
}

export interface TimelineRunInput {
  taskId: string;
  status: string;
  createdAt: string;
  settledAt: string | null;
  safeError: string | null;
}

export const STAGE_LABEL: Record<TimelineStage, string> = {
  pending: "Pending",
  in_progress: "In progress",
  needs_approval: "Needs approval",
  completed: "Completed",
  failed: "Failed",
};

export const AI_ACTOR = "Trust Tai AI";
const UNKNOWN = "Unknown";

export function stageFromStatus(status: string): TimelineStage {
  if (status === "complete" || status === "completed") return "completed";
  if (status === "needs_approval") return "needs_approval";
  if (status === "failed") return "failed";
  if (["in_progress", "working", "in_review", "waiting", "blocked"].includes(status))
    return "in_progress";
  return "pending";
}

function activityStage(eventType: string): TimelineStage | null {
  if (/completed|complete/.test(eventType)) return "completed";
  if (/started|in_progress|assigned|claimed/.test(eventType)) return "in_progress";
  return null;
}

export function buildTaskTimeline(
  task: TimelineTaskInput,
  activities: TimelineActivityInput[],
  runs: TimelineRunInput[],
): TaskTimeline {
  const steps: TimelineStep[] = [
    { stage: "pending", at: task.createdAt, actor: task.createdByLabel ?? UNKNOWN, note: "Created" },
  ];
  for (const a of activities.filter((x) => x.entityId === task.id)) {
    const stage = activityStage(a.eventType);
    if (!stage) continue;
    steps.push({
      stage,
      at: a.occurredAt,
      actor: a.actorIsAgent ? AI_ACTOR : (a.actorLabel ?? UNKNOWN),
    });
  }
  for (const r of runs.filter((x) => x.taskId === task.id)) {
    steps.push({ stage: "in_progress", at: r.createdAt, actor: AI_ACTOR, note: "AI run started" });
    const end = stageFromStatus(r.status);
    if (end !== "in_progress" && end !== "pending") {
      steps.push({
        stage: end,
        at: r.settledAt,
        actor: AI_ACTOR,
        ...(r.safeError ? { note: r.safeError } : {}),
      });
    }
  }
  const current = stageFromStatus(task.status);
  if (!steps.some((s) => s.stage === current)) {
    steps.push({
      stage: current,
      at: current === "pending" ? task.createdAt : null,
      actor:
        task.assigneeKind === "agent" ? AI_ACTOR : (task.ownerLabel ?? UNKNOWN),
      note: "Time not recorded",
    });
  }
  steps.sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));
  return {
    taskId: task.id,
    title: task.title,
    current,
    ownerLabel: task.assigneeKind === "agent" ? AI_ACTOR : (task.ownerLabel ?? UNKNOWN),
    steps,
    lastAt: steps.reduce((m, s) => (s.at && s.at > m ? s.at : m), task.updatedAt),
  };
}

export function filterTimelines(
  items: TaskTimeline[],
  filter: { stage?: TimelineStage | "all"; owner?: string | "all" },
): TaskTimeline[] {
  return items
    .filter((t) => !filter.stage || filter.stage === "all" || t.current === filter.stage)
    .filter((t) => !filter.owner || filter.owner === "all" || t.ownerLabel === filter.owner)
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
