/**
 * Browser reads (RLS as the signed-in member) for agent runs and task timelines.
 * A missing run table is reported as unavailable, never as zero runs.
 */
import { supabase } from "@/integrations/trust-tai/supabase";
import type { ManualTaskRecord, StewardAgentRun } from "@/domain/steward-accountability";
import { buildTaskTimeline, type TaskTimeline } from "@/domain/steward-task-timeline";
import { stewardTasks } from "@/data/supabase/steward-tasks";

const MISSING = /does not exist|schema cache|42P01|PGRST20[0-9]/i;
type Row = Record<string, unknown>;

export interface RunsRead {
  available: boolean;
  runs: StewardAgentRun[];
}

function toRun(row: Row): StewardAgentRun {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    taskId: String(row["task_id"]),
    agentId: String(row["agent_id"] ?? ""),
    status: row["status"] as StewardAgentRun["status"],
    risk: (row["risk"] ?? "low") as StewardAgentRun["risk"],
    artifact: (row["artifact"] as string | null) ?? null,
    evidenceRefs: Array.isArray(row["evidence_refs"]) ? (row["evidence_refs"] as string[]) : [],
    safeError: (row["safe_error"] as string | null) ?? null,
    model: (row["model"] as string | null) ?? null,
    providerRunId: (row["provider_run_id"] as string | null) ?? null,
    createdAt: String(row["created_at"] ?? row["started_at"] ?? ""),
    settledAt: (row["settled_at"] as string | null) ?? null,
  };
}

/** Status-only columns for team views: no artifact, evidence or model detail. */
const STATUS_COLUMNS = "id, organization_id, task_id, agent_id, status, risk, created_at, started_at, settled_at";

/**
 * Detailed runs are visible only to the person who requested them (RLS).
 * Pass `detail: false` for any aggregate or team surface.
 */
export async function readAgentRuns(
  organizationId: string,
  opts: { detail?: boolean } = {},
): Promise<RunsRead> {
  const { data, error } = await supabase
    .from("steward_agent_runs")
    .select(opts.detail ? "*" : STATUS_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (MISSING.test(`${error.code} ${error.message}`)) return { available: false, runs: [] };
    throw new Error(error.message);
  }
  return { available: true, runs: (data ?? []).map((r) => toRun(r as unknown as Row)) };
}

export async function readAgentQueue(organizationId: string) {
  const [tasks, runs] = await Promise.all([
    stewardTasks.list(organizationId),
    readAgentRuns(organizationId, { detail: true }),
  ]);
  return { tasks: tasks.filter((t) => t.assigneeKind === "agent"), ...runs };
}

export interface TimelineRead {
  timelines: TaskTimeline[];
  runsAvailable: boolean;
}

export async function readTaskTimelines(
  organizationId: string,
  people: Map<string, string>,
): Promise<TimelineRead> {
  const [tasks, runs, acts] = await Promise.all([
    stewardTasks.list(organizationId),
    readAgentRuns(organizationId),
    supabase
      .from("activities")
      .select("entity_id, event_type, occurred_at, actor_user_id, payload")
      .eq("organization_id", organizationId)
      .eq("entity_type", "task")
      .order("occurred_at", { ascending: false })
      .limit(1000),
  ]);
  const activities = acts.error
    ? []
    : (acts.data ?? []).map((a) => {
        const row = a as Row;
        const payload = (row["payload"] ?? {}) as Row;
        const actorId = row["actor_user_id"] as string | null;
        return {
          entityId: String(row["entity_id"] ?? ""),
          eventType: String(row["event_type"] ?? ""),
          occurredAt: String(row["occurred_at"] ?? ""),
          actorIsAgent: payload["actor_is_agent"] === true,
          ...(actorId && people.get(actorId) ? { actorLabel: people.get(actorId)! } : {}),
        };
      });
  const label = (id?: string) => (id ? people.get(id) : undefined);
  const timelines = tasks.map((t: ManualTaskRecord) =>
    buildTaskTimeline(
      {
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeKind: t.assigneeKind,
        ...(t.ownerLabel || label(t.ownerUserId)
          ? { ownerLabel: t.ownerLabel ?? label(t.ownerUserId)! }
          : {}),
        ...(label(t.createdBy) ? { createdByLabel: label(t.createdBy)! } : {}),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      },
      activities,
      runs.runs.map((r) => ({
        taskId: r.taskId,
        status: r.status,
        createdAt: r.createdAt,
        settledAt: r.settledAt,
        safeError: r.safeError,
      })),
    ),
  );
  return { timelines, runsAvailable: runs.available };
}
