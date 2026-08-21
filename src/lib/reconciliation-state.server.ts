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
  TerminalSignal,
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
  const terminal: TerminalSignal[] = [];
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

  /* ------------------------------------------------------------ ICP fit */

  /* Fit is only readable here when Scout already persisted its own canonical
   * evaluation. Nothing is recomputed, no page is fetched, no model is asked.
   * One waiting company without a stored evaluation makes the whole kind
   * unreadable, because "no strong fit is waiting" would then be a guess. */
  if (prospectRows.ok) {
    const waiting = prospectRows.rows.filter((row) => {
      const status = String(row["status"] ?? "");
      return status === "discovered" || status === "reviewing";
    });
    const evaluated = waiting.map((row) => ({ row, fit: canonicalFit(row) }));
    if (evaluated.every((entry) => entry.fit !== null)) {
      readableKinds.push("strong_fit_unreviewed");
      const strong = evaluated.filter(
        (entry) => entry.fit!.scoreable && entry.fit!.score >= STRONG_FIT_SCORE,
      );
      if (strong.length > 0) {
        conditions.push({
          kind: "strong_fit_unreviewed",
          statement: `${strong.length} compan${strong.length === 1 ? "y reads" : "ies read"} as a strong ICP fit and ${strong.length === 1 ? "has" : "have"} not been reviewed.`,
          sourceRefs: strong.map((entry) => `scout:fit:${String(entry.row["id"])}`),
          observedAt: nowIso,
        });
      }
    } else {
      unreadable.push("scout:fit");
    }
  }

  /* --------------------------------------- explicit owning room decisions */

  if (projectRows.ok) {
    for (const project of projects) {
      const state = project.state;
      const kinds = ["project_delayed", "project_blocked", "no_active_project"];
      if (state === "delivered") {
        terminal.push({
          entity: { type: "project", id: project.id },
          kinds,
          disposition: "resolved",
          statement: `Projects recorded ${project.name} as delivered.`,
          sourceRefs: [`projects:state:${project.id}`],
          ...(project.updatedAt ? { changedAt: project.updatedAt } : {}),
          observedAt: nowIso,
        });
      } else if (state === "closed") {
        terminal.push({
          entity: { type: "project", id: project.id },
          kinds,
          disposition: "abandoned",
          statement: `Projects closed ${project.name} without it being delivered.`,
          sourceRefs: [`projects:state:${project.id}`],
          ...(project.updatedAt ? { changedAt: project.updatedAt } : {}),
          observedAt: nowIso,
        });
      }
    }
  }

  if (prospectRows.ok) {
    for (const row of prospectRows.rows) {
      const id = String(row["id"]);
      const status = String(row["status"] ?? "");
      const name = String(row["company_name"] ?? "This company");
      const kinds = ["strong_fit_unreviewed", "pipeline_unrouted"];
      const changed = typeof row["updated_at"] === "string" ? String(row["updated_at"]) : undefined;
      if (status === "passed" || status === "converted") {
        terminal.push({
          entity: { type: "prospect", id },
          kinds,
          disposition: "resolved",
          statement:
            status === "passed"
              ? `Scout recorded a decision on ${name}: it was passed on.`
              : `Scout recorded ${name} as converted.`,
          sourceRefs: [`scout:status:${id}`],
          ...(changed ? { changedAt: changed } : {}),
          observedAt: nowIso,
        });
      } else if (status === "archived") {
        terminal.push({
          entity: { type: "prospect", id },
          kinds,
          disposition: "ambiguous",
          statement: `${name} was archived in Scout without a recorded decision.`,
          sourceRefs: [`scout:status:${id}`],
          ...(changed ? { changedAt: changed } : {}),
          observedAt: nowIso,
        });
      }
    }
  }

  if (relationshipRows.ok) {
    for (const relationship of relationships) {
      const label = relationship.name || "This relationship";
      if (relationship.stage === "archived") {
        terminal.push({
          entity: { type: "relationship", id: relationship.id },
          kinds: ["reply_debt"],
          disposition: "abandoned",
          statement: `Comms archived ${label} rather than answering it.`,
          sourceRefs: [`comms:relationship:${relationship.id}`],
          observedAt: nowIso,
        });
      } else if (relationship.stage === "dormant") {
        terminal.push({
          entity: { type: "relationship", id: relationship.id },
          kinds: ["reply_debt"],
          disposition: "ambiguous",
          statement: `${label} was moved to dormant, which does not say whether the reply was owed.`,
          sourceRefs: [`comms:relationship:${relationship.id}`],
          observedAt: nowIso,
        });
      }
    }
  }

  if (decisionRows.ok) {
    for (const decision of decisions) {
      const kinds = ["open_decisions", "roadmap_direction_undecided"];
      if (decision.status === "approved" || decision.status === "declined") {
        terminal.push({
          entity: { type: "decision", id: decision.id },
          kinds,
          disposition: "resolved",
          statement: `Roadmap recorded an answer on this decision: ${decision.status}.`,
          sourceRefs: [`roadmap:decision:${decision.id}`],
          observedAt: nowIso,
        });
      } else if (decision.status === "deferred") {
        terminal.push({
          entity: { type: "decision", id: decision.id },
          kinds,
          disposition: "ambiguous",
          statement: "This roadmap decision was deferred, which is not an answer yet.",
          sourceRefs: [`roadmap:decision:${decision.id}`],
          observedAt: nowIso,
        });
      }
    }
  }

  if (commitmentRows.ok) {
    for (const row of commitmentRows.rows) {
      const id = String(row["id"]);
      const status = String(row["status"] ?? "");
      if (status === "kept") {
        terminal.push({
          entity: { type: "task", id },
          kinds: ["commitment_overdue"],
          disposition: "resolved",
          statement: "Steward recorded this promise as kept.",
          sourceRefs: [`steward-commitment-${id}`],
          observedAt: nowIso,
        });
      } else if (status === "released") {
        terminal.push({
          entity: { type: "task", id },
          kinds: ["commitment_overdue"],
          disposition: "abandoned",
          statement: "Steward recorded this promise as released rather than kept.",
          sourceRefs: [`steward-commitment-${id}`],
          observedAt: nowIso,
        });
      }
    }
  }

  return { organizationId, now: nowIso, readableKinds, conditions, terminal, unreadable };
}

/** The strong fit line the Scout board already uses. */
export const STRONG_FIT_SCORE = 70;

/**
 * Scout's own persisted evaluation for one company, or nothing.
 *
 * Only the canonical evaluation counts. A bare `fit_score` with no recorded
 * evaluation is not treated as evidence, because it cannot say whether the
 * company was scoreable at all.
 */
function canonicalFit(row: Row): { score: number; scoreable: boolean } | null {
  const metadata = (row["metadata"] ?? {}) as Record<string, unknown>;
  const fit = metadata["scout_fit"] as Record<string, unknown> | undefined;
  if (!fit || typeof fit !== "object") return null;
  if (typeof fit["score"] !== "number" || typeof fit["scoreable"] !== "boolean") return null;
  return { score: fit["score"] as number, scoreable: fit["scoreable"] as boolean };
}
