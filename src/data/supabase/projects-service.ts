/**
 * Projects service — the one place delivery state is written.
 *
 * Projects does not own companies, people, roadmaps or history. It points at
 * them by id and mirrors every state change into the shared `activities`
 * stream, so Home, Pulse and Ask Trust Tai read the same truth.
 *
 * The `projects` table is managed outside this project. Every write goes
 * through `writeTolerant`, and the execution detail Projects adds (origin,
 * evidence, dependencies, boundary, last moved) is mirrored into `metadata` so
 * a column difference can never lose a person's work. Reads prefer a real
 * column and fall back to metadata.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ActivityName } from "@/domain/activity";
import type { EvidenceRef } from "@/domain/confidence";
import type { ID } from "@/domain/entities";
import type {
  ExecutionProject,
  ExecutionState,
  ProjectInput,
  ProjectOrigin,
} from "@/domain/projects";
import { LIFECYCLE_FOR_STATE, stateFromLifecycle } from "@/domain/projects";

import { supabaseActivity } from "./activities";
import { writeTolerant, type Row } from "./schema";

export interface ProjectsContext {
  organizationId: ID;
  userId: ID;
  userLabel?: string | undefined;
}

const REQUIRED = ["organization_id", "name"];

function metaOf(row: Row): Row {
  const value = row["metadata"];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function evidenceOf(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: String(entry["label"] ?? "Evidence"),
      kind: (str(entry["kind"]) as EvidenceRef["kind"]) ?? "provider",
      ...(str(entry["url"]) ? { url: String(entry["url"]) } : {}),
    }));
}

function originOf(value: unknown): ProjectOrigin {
  if (!value || typeof value !== "object") return { kind: "manual" };
  const row = value as Row;
  return {
    kind: row["kind"] === "roadmap_milestone" ? "roadmap_milestone" : "manual",
    ...(str(row["roadmapId"]) ? { roadmapId: String(row["roadmapId"]) } : {}),
    ...(str(row["milestoneId"]) ? { milestoneId: String(row["milestoneId"]) } : {}),
    ...(str(row["subjectLabel"]) ? { subjectLabel: String(row["subjectLabel"]) } : {}),
  };
}

export function toProject(row: Row): ExecutionProject {
  const meta = metaOf(row);
  const createdAt = String(row["created_at"] ?? new Date().toISOString());
  const updatedAt = String(row["updated_at"] ?? createdAt);
  const state = (str(meta["execution_state"]) as ExecutionState | undefined) ??
    stateFromLifecycle(str(row["status"]));

  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    name: String(row["name"] ?? row["title"] ?? "Untitled project"),
    state,
    ...(str(row["client_id"]) ? { clientId: String(row["client_id"]) } : {}),
    ...(str(row["owner_user_id"]) ? { ownerUserId: String(row["owner_user_id"]) } : {}),
    ...(str(meta["owner_label"]) ? { ownerLabel: String(meta["owner_label"]) } : {}),
    pointA: String(row["point_a"] ?? meta["point_a"] ?? ""),
    pointB: String(row["point_b"] ?? meta["point_b"] ?? ""),
    ...(str(row["next_move"]) || str(meta["next_move"])
      ? { nextMove: String(row["next_move"] ?? meta["next_move"]) }
      : {}),
    ...(str(meta["blocked_because"]) ? { blockedBecause: String(meta["blocked_because"]) } : {}),
    evidence: evidenceOf(meta["evidence"]),
    dependencies: Array.isArray(meta["dependencies"])
      ? (meta["dependencies"] as unknown[]).map((entry) => String(entry))
      : [],
    ...(str(meta["execution_boundary"])
      ? { executionBoundary: String(meta["execution_boundary"]) }
      : {}),
    origin: originOf(meta["origin"]),
    lastMovedAt: String(meta["last_moved_at"] ?? updatedAt),
    createdAt,
    updatedAt,
  };
}

async function record(
  context: ProjectsContext,
  name: ActivityName,
  project: { id: ID; name: string },
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const at = new Date().toISOString();
  try {
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name,
      subject: { type: "project", id: project.id, label: project.name },
      summary,
      payload,
      provenance: {
        appId: "projects",
        actor: { type: "user", id: context.userId, ...(context.userLabel ? { label: context.userLabel } : {}) },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });
  } catch {
    // History matters, but never enough to lose the person's work.
  }
}

function payloadFor(input: ProjectInput, state: ExecutionState, now: string): Row {
  const metadata: Row = {
    execution_state: state,
    point_a: input.pointA,
    point_b: input.pointB,
    next_move: input.nextMove ?? null,
    owner_label: input.ownerLabel ?? null,
    evidence: input.evidence ?? [],
    dependencies: input.dependencies ?? [],
    execution_boundary: input.executionBoundary ?? null,
    origin: input.origin,
    last_moved_at: now,
  };
  return {
    name: input.name,
    status: LIFECYCLE_FOR_STATE[state],
    point_a: input.pointA,
    point_b: input.pointB,
    next_move: input.nextMove ?? null,
    client_id: input.clientId ?? null,
    owner_user_id: input.ownerUserId ?? null,
    metadata,
  };
}

export const projectsService = {
  /** Every project this organization can read, newest movement first. */
  async list(organizationId: ID): Promise<ExecutionProject[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => toProject(row as Row));
  },

  async get(id: ID, organizationId: ID): Promise<ExecutionProject | null> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toProject(data as Row) : null;
  },

  /**
   * Start work. When the input carries a milestone, this is idempotent: the
   * same milestone always resolves to the same project instead of a second one.
   */
  async start(input: ProjectInput, context: ProjectsContext): Promise<ExecutionProject> {
    const milestoneId = input.origin.milestoneId;
    if (milestoneId) {
      const existing = await projectsService.findByMilestone(milestoneId, context.organizationId);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const state: ExecutionState = "not_started";
    const payload: Row = {
      organization_id: context.organizationId,
      created_by: context.userId,
      ...payloadFor(input, state, now),
    };

    const { data, error } = await writeTolerant(payload, REQUIRED, async (body) =>
      await supabase.from("projects").insert(body).select("*").single(),
    );
    if (error || !data) throw new Error(error?.message ?? "That project could not be started.");

    const project = toProject(data as Row);
    await record(
      context,
      "project.started",
      project,
      input.origin.kind === "roadmap_milestone"
        ? `${project.name} entered delivery from an approved roadmap milestone.`
        : `${project.name} was started in Projects.`,
      { origin: input.origin },
    );
    return project;
  },

  async findByMilestone(milestoneId: ID, organizationId: ID): Promise<ExecutionProject | null> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("organization_id", organizationId)
      .contains("metadata", { origin: { milestoneId } });
    if (error) {
      // A backend without jsonb containment support is not a reason to fail the
      // read; fall back to scanning what this organization can already see.
      const all = await projectsService.list(organizationId);
      return all.find((project) => project.origin.milestoneId === milestoneId) ?? null;
    }
    const rows = (data ?? []).map((row) => toProject(row as Row));
    return rows[0] ?? null;
  },

  /** Move the work. State, next move and blocks are all a person's decision. */
  async update(
    project: ExecutionProject,
    changes: {
      state?: ExecutionState;
      nextMove?: string;
      blockedBecause?: string;
      ownerLabel?: string;
      ownerUserId?: ID;
      pointB?: string;
    },
    context: ProjectsContext,
  ): Promise<ExecutionProject> {
    const now = new Date().toISOString();
    const state = changes.state ?? project.state;
    const next: ProjectInput = {
      name: project.name,
      pointA: project.pointA,
      pointB: changes.pointB ?? project.pointB,
      ...(changes.nextMove ?? project.nextMove
        ? { nextMove: changes.nextMove ?? project.nextMove }
        : {}),
      ...(changes.ownerUserId ?? project.ownerUserId
        ? { ownerUserId: changes.ownerUserId ?? project.ownerUserId }
        : {}),
      ...(changes.ownerLabel ?? project.ownerLabel
        ? { ownerLabel: changes.ownerLabel ?? project.ownerLabel }
        : {}),
      ...(project.clientId ? { clientId: project.clientId } : {}),
      evidence: project.evidence,
      dependencies: project.dependencies,
      ...(project.executionBoundary ? { executionBoundary: project.executionBoundary } : {}),
      origin: project.origin,
    };

    const body = payloadFor(next, state, now);
    const metadata = body["metadata"] as Row;
    metadata["blocked_because"] =
      state === "blocked" ? (changes.blockedBecause ?? project.blockedBecause ?? null) : null;

    const { data, error } = await writeTolerant({ ...body, updated_at: now }, REQUIRED, async (payload) =>
      await supabase
        .from("projects")
        .update(payload)
        .eq("id", project.id)
        .eq("organization_id", context.organizationId)
        .select("*")
        .single(),
    );
    if (error || !data) throw new Error(error?.message ?? "That change could not be saved.");

    const saved = toProject(data as Row);
    if (changes.state && changes.state !== project.state) {
      await record(
        context,
        changes.state === "blocked" ? "project.blocked" : "project.status_changed",
        saved,
        `${saved.name} moved to ${changes.state.replace(/_/g, " ")}.`,
        { from: project.state, to: changes.state },
      );
    } else {
      await record(context, "project.next_move_changed", saved, `${saved.name} was updated.`);
    }
    return saved;
  },
};
