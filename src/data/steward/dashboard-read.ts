/**
 * One read for the per-person Steward dashboard ("Your Dashboard" / My Week).
 *
 * It answers a single person's week from rows that already exist: their weekly
 * goal, their Steward tasks, and their own activity rows from the shared
 * public.activities stream. The activity rows serve two jobs at once, the feed
 * a person reads and the raw material the pure stat functions aggregate.
 *
 * Nothing here invents a value. Every source is fetched fail-closed: a source
 * that cannot be read contributes empty, and the surface renders honest zeros.
 * No new table is created; the activities stream is the ledger.
 */

import { listForActor } from "@/data/supabase/activities";
import { loadWorkspacePeople } from "@/data/daily-workspace";
import { weeklyGoals } from "@/data/supabase/weekly-goals";
import type { ActivityEvent } from "@/domain/activity";
import type { StewardOwner, StewardTask } from "@/domain/steward-accountability";
import type { StewardAgentRead } from "@/domain/steward-accountability";
import type { WeeklyGoalRecord } from "@/domain/steward-weekly-goal";

import { readStewardTeam, weekStartOf } from "./team-read";

/** The identity block a dashboard header renders. Always from real rows. */
export interface DashboardIdentity {
  userId: string;
  name: string;
  initials: string;
  /** A short role line, e.g. "Founder · Trust Tai". Optional, honest when absent. */
  role: string | null;
}

/**
 * One activity row reshaped for the feed and stats. `actorIsAgent` and
 * `minutesSaved` are read only from real payload fields; a row without them
 * simply carries the honest defaults (not an agent, no estimate).
 */
export interface DashboardActivity {
  id: string;
  eventType: string;
  summary: string;
  occurredAt: string;
  entityId: string;
  /** True when the row records an AI/agent action for this person. */
  actorIsAgent: boolean;
  /** A real minutes-saved estimate, only when the row carries one. */
  minutesSaved?: number;
  /** True when the row is reversible (an agent clear that Undo can reverse). */
  reversible: boolean;
  /** True when the row flags a gated draft awaiting a person's review. */
  needsReview: boolean;
  /** True when this row has already been reversed by a compensating event. */
  undone: boolean;
}

export interface StewardDashboardRead {
  now: string;
  weekStart: string;
  identity: DashboardIdentity;
  weeklyGoal: WeeklyGoalRecord | null;
  /** Only this person's tasks, by owner user id. Empty when none. */
  tasks: StewardTask[];
  /** This person's recent activity rows, newest first, for the feed. */
  activities: DashboardActivity[];
  people: { key: string; name: string; initials: string; userId: string }[];
  agents: StewardAgentRead;
  taskStorageAvailable: boolean;
}

/**
 * `ActivityName` is a closed union (`${ActivityScope}.${ActivityAction}`) with
 * no "cleared" action, so an agent-clear is written as a real, valid name,
 * `task.status_changed`, and distinguished from an ordinary status change only
 * by an explicit `agent_cleared: true` payload flag (see `undoAgentCleared` in
 * src/data/steward/actions.ts for the compensating write).
 */
const AGENT_CLEAR_EVENT: ActivityEvent["name"] = "task.status_changed";

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === true;
}

/**
 * Reshape a raw activity row for the dashboard. All flags come from real data:
 * agent authorship from the event type or an explicit payload flag, minutes
 * only from a real payload estimate, review and reversible only from payload
 * flags the writer set. Nothing is assumed.
 */
function toDashboardActivity(event: ActivityEvent): DashboardActivity {
  const payload = event.payload ?? {};
  const eventType = event.name;
  const isAgentClear = eventType === AGENT_CLEAR_EVENT && bool(payload["agent_cleared"]);
  const actorIsAgent =
    isAgentClear || bool(payload["actor_is_agent"]) || payload["actor_kind"] === "agent";
  const minutesSaved = num(payload["minutes_saved"]);
  const reversible = isAgentClear || bool(payload["reversible"]);
  const needsReview = bool(payload["needs_review"]) || payload["review_state"] === "gated";
  return {
    id: event.id,
    eventType,
    summary: event.summary,
    occurredAt: event.occurredAt,
    entityId: event.subject.id,
    actorIsAgent,
    ...(minutesSaved !== undefined ? { minutesSaved } : {}),
    reversible,
    needsReview,
    undone: false,
  };
}

/**
 * Mark any activity that a later compensating event has reversed. A clear
 * whose original activity id is named by a `undoes_activity_id` payload flag
 * (see `undoAgentCleared` in src/data/steward/actions.ts) is shown as undone,
 * and neither its Undo affordance nor its minutes are offered again. History
 * is never deleted; the compensating row is the record of the reversal.
 */
function markUndone(rows: DashboardActivity[], raw: ActivityEvent[]): DashboardActivity[] {
  const undoneActivityIds = new Set<string>();
  for (const event of raw) {
    const undoes = event.payload?.["undoes_activity_id"];
    if (typeof undoes === "string" && undoes) undoneActivityIds.add(undoes);
  }
  if (undoneActivityIds.size === 0) return rows;
  return rows.map((row) =>
    row.reversible && undoneActivityIds.has(row.id) ? { ...row, undone: true } : row,
  );
}

function ownerInitialsOf(owner: StewardOwner | undefined, fallbackName: string): string {
  if (owner?.initials) return owner.initials;
  const parts = fallbackName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

/**
 * Read one person's dashboard.
 *
 * @param organizationId the workspace.
 * @param targetUserId   the person whose week is being read.
 * @param targetName     that person's display name, for the header and initials.
 * @param targetRole     an optional role line, shown only when present.
 */
export async function readStewardDashboard(
  organizationId: string,
  targetUserId: string,
  targetName: string,
  targetRole?: string | null,
): Promise<StewardDashboardRead> {
  const now = new Date().toISOString();
  const weekStart = weekStartOf(now);
  /* Activity for stats reaches back further than the feed window: a streak can
     legitimately span more than a week. The feed itself slices the recent rows. */
  const sinceISO = new Date(Date.parse(now) - 60 * 86_400_000).toISOString();

  const [team, weeklyGoal, rawActivities, peopleRead] = await Promise.all([
    /* The shared checklist read is already fail-closed internally; a full
       failure is still caught so one bad source never blanks the page. */
    readStewardTeam(organizationId, targetUserId).catch(() => null),
    weeklyGoals
      .currentFor(organizationId, targetUserId, weekStart)
      .catch((): WeeklyGoalRecord | null => null),
    listForActor(organizationId, targetUserId, sinceISO, 200).catch((): ActivityEvent[] => []),
    loadWorkspacePeople(organizationId).catch(() => null),
  ]);

  const allTasks = team?.tasks ?? [];
  const tasks = allTasks.filter((task) => task.owner.userId === targetUserId);

  const activities = markUndone(rawActivities.map(toDashboardActivity), rawActivities);
  const people = (peopleRead?.people ?? [])
    .filter((person) => person.active)
    .map((person) => ({
      key: person.userId,
      userId: person.userId,
      name: person.displayName,
      initials: ownerInitialsOf(undefined, person.displayName),
    }));

  const ownerFromTask = tasks.find((task) => task.owner.userId === targetUserId)?.owner;

  return {
    now,
    weekStart,
    identity: {
      userId: targetUserId,
      name: targetName,
      initials: ownerInitialsOf(ownerFromTask, targetName),
      role: targetRole ?? null,
    },
    weeklyGoal,
    tasks,
    activities,
    people,
    agents: team?.agents ?? {
      agents: [],
      connected: false,
      because: "AI teammates could not be read right now.",
      syncHealth: null,
      liveFailureDetail: null,
    },
    taskStorageAvailable: team !== null,
  };
}
