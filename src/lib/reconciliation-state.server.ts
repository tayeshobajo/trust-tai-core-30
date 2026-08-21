/**
 * The smallest server readable business state reconciliation can honestly use.
 *
 * The signed in suite snapshot is a reading surface: it loads everything a
 * person might look at, through the browser session. The scheduler needs far
 * less than that, and it must never depend on someone being signed in, so this
 * reads the same canonical room tables directly with the Core service role
 * client and returns only the conditions the existing deterministic checks
 * already understand.
 *
 * Rules held here:
 *  - canonical tables only, never a shadow copy of a room
 *  - organization scoped, read only, no user impersonation, no model
 *  - a room that cannot be read is reported as unreadable, and every check
 *    that depends on it stays unknown rather than reading as cleared
 *  - source references travel with each condition, room state does not
 */

import { toProject } from "@/data/supabase/projects-service";
import { toRelationship, type RelationshipRow } from "@/data/supabase/comms-schema";
import { toRoadmap, toDecision } from "@/data/supabase/roadmap-schema";
import { isOpenProject, projectHealth } from "@/domain/projects";
import { dueState } from "@/domain/comms";
import type {
  ReconciliationSnapshot,
  StateCondition,
} from "@/data/intelligence/canon/outcome-checks";

type Client = { from: (table: string) => any };

type Row = Record<string, unknown>;

const CLOSED_PROSPECT_STATUSES = new Set(["passed", "archived", "won", "lost"]);

interface RoomRead {
  rows: Row[];
  ok: boolean;
}

async function readRows(
  client: Client,
  table: string,
  organizationId: string,
  limit = 500,
): Promise<RoomRead> {
  try {
    const { data, error } = await client
      .from(table)
      .select("*")
      .eq("organization_id", organizationId)
      .limit(limit);
    if (error) return { rows: [], ok: false };
    return { rows: (data ?? []) as Row[], ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

/**
 * Read current business state for one organization.
 *
 * Every kind listed in `readableKinds` was genuinely read on this pass. A kind
 * missing from that list means the evaluator must answer unknown.
 */
export async function loadReconciliationSnapshot(
  client: Client,
  organizationId: string,
  now = new Date(),
): Promise<ReconciliationSnapshot> {
  const nowIso = now.toISOString();
  const conditions: StateCondition[] = [];
  const readableKinds: string[] = [];
  const unreadable: string[] = [];

  const [projectRows, relationshipRows, prospectRows, roadmapRows, decisionRows, commitmentRows] =
    await Promise.all([
      readRows(client, "projects", organizationId),
      readRows(client, "comms_relationships", organizationId),
      readRows(client, "prospects", organizationId),
      readRows(client, "roadmaps", organizationId),
      readRows(client, "roadmap_decisions", organizationId, 800),
      readRows(client, "commitments", organizationId, 800),
    ]);

  const projects = projectRows.ok ? projectRows.rows.map((row) => toProject(row as never)) : [];
  const relationships = relationshipRows.ok
    ? relationshipRows.rows.map((row) => toRelationship(row as unknown as RelationshipRow))
    : [];
  const roadmaps = roadmapRows.ok ? roadmapRows.rows.map((row) => toRoadmap(row)) : [];
  const decisions = decisionRows.ok ? decisionRows.rows.map((row) => toDecision(row)) : [];

  /* ------------------------------------------------------------- delivery */

  if (projectRows.ok) {
    readableKinds.push("project_delayed", "project_blocked");
    const open = projects.filter(isOpenProject);

    for (const project of open) {
      const health = projectHealth(project, now);
      if (health.level === "at_risk" || health.level === "needs_attention") {
        conditions.push({
          kind: "project_delayed",
          statement: `${project.name} is still ${project.state.replace(/_/g, " ")} and has not moved.`,
          sourceRefs: [`projects:state:${project.id}`, `projects:health:${project.id}`],
          observedAt: nowIso,
        });
      }
      if (project.state === "blocked" && project.blockedBecause) {
        conditions.push({
          kind: "project_blocked",
          statement: `${project.name} is blocked: ${project.blockedBecause}`,
          sourceRefs: [`projects:state:${project.id}`],
          observedAt: nowIso,
        });
      }
    }

    /* No active project is only readable when there is also someone to serve. */
    if (relationshipRows.ok && prospectRows.ok && roadmapRows.ok) {
      readableKinds.push("no_active_project");
      const hasAnyoneToServe =
        relationships.length > 0 || prospectRows.rows.length > 0 || roadmaps.length > 0;
      if (open.length === 0 && hasAnyoneToServe) {
        conditions.push({
          kind: "no_active_project",
          statement: "No project is open while there are still companies and people in the suite.",
          sourceRefs: ["projects:open:none"],
          observedAt: nowIso,
        });
      }
    } else {
      unreadable.push("projects:no_active_project");
    }
  } else {
    unreadable.push("projects");
  }

  /* -------------------------------------------------------- follow-through */

  if (relationshipRows.ok) {
    readableKinds.push("reply_debt");
    const overdue = relationships.filter((relationship) => dueState(relationship, now) === "overdue");
    if (overdue.length > 0) {
      conditions.push({
        kind: "reply_debt",
        statement: `${overdue.length} relationship${overdue.length === 1 ? " is" : "s are"} past the date a reply was owed.`,
        sourceRefs: overdue.map((relationship) => `comms:relationship:${relationship.id}`),
        observedAt: nowIso,
      });
    }
  } else {
    unreadable.push("comms");
  }

  if (commitmentRows.ok) {
    readableKinds.push("commitment_overdue");
    const overdue = commitmentRows.rows.filter((row) => {
      const status = String(row["status"] ?? "open");
      if (status !== "open" && status !== "waiting") return false;
      const due = row["due_at"] ? Date.parse(String(row["due_at"])) : NaN;
      return !Number.isNaN(due) && due < now.getTime();
    });
    if (overdue.length > 0) {
      conditions.push({
        kind: "commitment_overdue",
        statement: `${overdue.length} promise${overdue.length === 1 ? " has" : "s have"} passed the date a person set.`,
        sourceRefs: overdue.map((row) => `steward-commitment-${String(row["id"])}`),
        observedAt: nowIso,
      });
    }
  } else {
    unreadable.push("steward");
  }

  /* -------------------------------------------------------------- roadmap */

  if (decisionRows.ok) {
    readableKinds.push("open_decisions");
    const open = decisions.filter((decision) => decision.status === "open");
    if (open.length > 0) {
      conditions.push({
        kind: "open_decisions",
        statement: `${open.length} roadmap decision${open.length === 1 ? " is" : "s are"} still waiting on an answer.`,
        sourceRefs: open.map((decision) => `roadmap:decision:${decision.id}`),
        observedAt: nowIso,
      });
    }
  } else {
    unreadable.push("roadmap:decisions");
  }

  if (roadmapRows.ok) {
    readableKinds.push("roadmap_direction_undecided");
    const undecided = roadmaps.filter(
      (roadmap) =>
        roadmap.status !== "archived" && roadmap.status !== "complete" && roadmap.pointB === null,
    );
    if (undecided.length > 0) {
      conditions.push({
        kind: "roadmap_direction_undecided",
        statement: `${undecided.length} live roadmap${undecided.length === 1 ? " has" : "s have"} no agreed destination.`,
        sourceRefs: undecided.map((roadmap) => `roadmap:${roadmap.id}`),
        observedAt: nowIso,
      });
    }
  } else {
    unreadable.push("roadmap");
  }

  /* ------------------------------------------------------------- pipeline */

  if (prospectRows.ok && relationshipRows.ok) {
    readableKinds.push("pipeline_unrouted");
    const routed = new Set(
      relationships.map((relationship) => relationship.prospectId).filter(Boolean),
    );
    const unrouted = prospectRows.rows.filter((row) => {
      const status = String(row["status"] ?? "");
      if (CLOSED_PROSPECT_STATUSES.has(status)) return false;
      if (status !== "qualified" && status !== "ready_for_comms") return false;
      return !routed.has(String(row["id"]));
    });
    if (unrouted.length > 0) {
      conditions.push({
        kind: "pipeline_unrouted",
        statement: `${unrouted.length} qualified compan${unrouted.length === 1 ? "y has" : "ies have"} no relationship in Comms.`,
        sourceRefs: unrouted.map((row) => `scout:status:${String(row["id"])}`),
        observedAt: nowIso,
      });
    }
  } else {
    unreadable.push("scout");
  }

  /* `strong_fit_unreviewed` needs scoring the board does on the client, so it
   * is deliberately absent from readableKinds and stays unknown here. */

  return { organizationId, now: nowIso, readableKinds, conditions, unreadable };
}
