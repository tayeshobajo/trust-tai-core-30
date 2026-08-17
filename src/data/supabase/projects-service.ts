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
import { STATUS_COLUMN_FOR_STATE, stateFromLifecycle } from "@/domain/projects";
import { can, type AccessContext } from "@/domain/access";
import {
  ROUTE_EVENT_KEY,
  ROUTE_TARGET_LABEL,
  buildRouteRequest,
  routeMetadata,
  routeSummary,
  type ProjectRouteRequest,
  type RouteIntent,
} from "@/domain/project-routing";

import { buildRouteLedger, canAcceptRoute, type RouteLedgerEntry } from "@/domain/route-ledger";

import { supabaseActivity } from "./activities";
import { emitSuiteEvent } from "@/data/events/suite-events";
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

function deliveryOf(value: unknown): { label: string; done: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return { label: entry, done: false };
      if (entry && typeof entry === "object") {
        const row = entry as Row;
        return { label: String(row["label"] ?? ""), done: row["done"] === true };
      }
      return { label: "", done: false };
    })
    .filter((item) => item.label.trim().length > 0);
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
  const state =
    (str(meta["execution_state"]) as ExecutionState | undefined) ??
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
    ...(str(row["blocked_since"]) || str(meta["blocked_since"])
      ? { blockedSince: String(row["blocked_since"] ?? meta["blocked_since"]) }
      : {}),
    ...(str(row["due_date"]) || str(meta["due_date"])
      ? { dueDate: String(row["due_date"] ?? meta["due_date"]) }
      : {}),
    deliveryItems: deliveryOf(meta["delivery_items"]),
    ...(str(row["current_work"]) || str(meta["current_work"])
      ? { currentWork: String(row["current_work"] ?? meta["current_work"]) }
      : {}),
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
        actor: {
          type: "user",
          id: context.userId,
          ...(context.userLabel ? { label: context.userLabel } : {}),
        },
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
    ...(input.dueDate ? { due_date: input.dueDate } : {}),
    ...(input.deliveryItems ? { delivery_items: input.deliveryItems } : {}),
    ...(input.currentWork ? { current_work: input.currentWork } : {}),
    last_moved_at: now,
  };
  return {
    name: input.name,
    status: STATUS_COLUMN_FOR_STATE[state],
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

    const { data, error } = await writeTolerant(
      payload,
      REQUIRED,
      async (body) => await supabase.from("projects").insert(body).select("*").single(),
    );
    if (error || !data) throw new Error(error?.message ?? "That project could not be started.");

    const project = toProject(data as Row);
    await emitSuiteEvent({
      key: "PROJECT_STARTED",
      organizationId: context.organizationId,
      actor: {
        type: "user",
        id: context.userId,
        ...(context.userLabel ? { label: context.userLabel } : {}),
      },
      subject: { type: "project", id: project.id, label: project.name },
      summary:
        input.origin.kind === "roadmap_milestone"
          ? `${project.name} entered delivery from an approved roadmap milestone.`
          : `${project.name} was started in Projects.`,
      sourceEventKey: `project.started:${project.id}`,
      metadata: { origin: input.origin },
    });
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

  /**
   * Move the work. State, next move and blocks are all a person's decision,
   * but only a legal one: an invalid transition is refused with the reason
   * rather than written and explained away later.
   */
  async update(
    project: ExecutionProject,
    changes: {
      state?: ExecutionState;
      nextMove?: string;
      blockedBecause?: string;
      ownerLabel?: string;
      ownerUserId?: ID;
      pointB?: string;
      dueDate?: string;
      currentWork?: string;
      deliveryItems?: { label: string; done: boolean }[];
    },
    context: ProjectsContext,
  ): Promise<ExecutionProject> {
    const now = new Date().toISOString();
    const state = changes.state ?? project.state;
    if (changes.state && changes.state !== project.state) {
      const check = checkTransition(project, changes.state, {
        ...(changes.blockedBecause ? { blockedBecause: changes.blockedBecause } : {}),
        ...(changes.ownerLabel ? { ownerLabel: changes.ownerLabel } : {}),
        ...(changes.ownerUserId ? { ownerUserId: changes.ownerUserId } : {}),
      });
      if (!check.ok) throw new Error(check.because);
    }
    const dueDate = changes.dueDate ?? project.dueDate;
    const currentWork = changes.currentWork ?? project.currentWork;
    const deliveryItems = changes.deliveryItems ?? project.deliveryItems;
    const next: ProjectInput = {
      name: project.name,
      pointA: project.pointA,
      pointB: changes.pointB ?? project.pointB,
      ...((changes.nextMove ?? project.nextMove)
        ? { nextMove: changes.nextMove ?? project.nextMove }
        : {}),
      ...((changes.ownerUserId ?? project.ownerUserId)
        ? { ownerUserId: changes.ownerUserId ?? project.ownerUserId }
        : {}),
      ...((changes.ownerLabel ?? project.ownerLabel)
        ? { ownerLabel: changes.ownerLabel ?? project.ownerLabel }
        : {}),
      ...(project.clientId ? { clientId: project.clientId } : {}),
      evidence: project.evidence,
      dependencies: project.dependencies,
      ...(project.executionBoundary ? { executionBoundary: project.executionBoundary } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(currentWork ? { currentWork } : {}),
      ...(deliveryItems ? { deliveryItems } : {}),
      origin: project.origin,
    };

    const body = payloadFor(next, state, now);
    const metadata = body["metadata"] as Row;
    metadata["blocked_because"] =
      state === "blocked" ? (changes.blockedBecause ?? project.blockedBecause ?? null) : null;
    // "Blocked for N days" is only honest if the clock starts when it first stopped.
    metadata["blocked_since"] =
      state === "blocked" ? (project.state === "blocked" ? (project.blockedSince ?? now) : now) : null;


    const { data, error } = await writeTolerant(
      { ...body, updated_at: now },
      REQUIRED,
      async (payload) =>
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
      if (changes.state === "blocked" || changes.state === "delivered") {
        await emitSuiteEvent({
          key: changes.state === "blocked" ? "PROJECT_BLOCKED" : "PROJECT_COMPLETED",
          organizationId: context.organizationId,
          actor: {
            type: "user",
            id: context.userId,
            ...(context.userLabel ? { label: context.userLabel } : {}),
          },
          subject: { type: "project", id: saved.id, label: saved.name },
          summary: `${saved.name} moved to ${changes.state.replace(/_/g, " ")}.`,
          sourceEventKey: `${changes.state === "blocked" ? "project.blocked" : "project.completed"}:${saved.id}:${saved.updatedAt}`,
          metadata: {
            from: project.state,
            to: changes.state,
            ...(saved.blockedBecause ? { blocked_because: saved.blockedBecause } : {}),
          },
        });
      } else {
        await record(
          context,
          "project.status_changed",
          saved,
          `${saved.name} moved to ${changes.state.replace(/_/g, " ")}.`,
          { from: project.state, to: changes.state },
        );
      }
    } else {
      await record(context, "project.next_move_changed", saved, `${saved.name} was updated.`);
    }
    return saved;
  },

  /**
   * Ask Ops or Studio to take a bounded piece of specialized work.
   *
   * A route is a request. Acceptance belongs to the receiving room, so this
   * writes no downstream state and claims none: it emits exactly one
   * Projects-owned suite event, keyed so a retry is the same happening.
   * A person with `projects.write` must ask; intelligence may only propose.
   */
  async routeWork(
    project: ExecutionProject,
    intent: RouteIntent,
    context: ProjectsContext,
    access: AccessContext | null | undefined,
  ): Promise<ProjectRouteRequest> {
    if (!can(access, "projects.write")) {
      throw new Error("Your role can read Projects but not route work out of it.");
    }
    const built = buildRouteRequest(project, intent);
    if (!built.ok) throw new Error(built.because);
    const request = built.request;

    await emitSuiteEvent({
      key: ROUTE_EVENT_KEY[request.targetApp],
      organizationId: request.organizationId,
      actor: {
        type: "user",
        id: context.userId,
        ...(context.userLabel ? { label: context.userLabel } : {}),
      },
      subject: { type: "project", id: request.projectId, label: request.projectName },
      related: [
        ...(request.clientId ? [{ type: "client" as const, id: request.clientId }] : []),
        ...(request.roadmapId ? [{ type: "roadmap" as const, id: request.roadmapId }] : []),
      ],
      summary: routeSummary(request),
      sourceEventKey: request.sourceEventKey,
      metadata: routeMetadata(request),
      confidence: "observed",
    });

    /*
     * Tell the receiving room a request exists. Delivery is best effort and
     * always recorded honestly: if no endpoint is configured for that room,
     * the ledger says so rather than implying somebody was told.
     */
    await notifyReceivingRoom(request, context);

    return request;
  },

  /** Every route this organization has asked for, read from the shared stream. */
  async routeLedger(organizationId: ID, limit = 200): Promise<RouteLedgerEntry[]> {
    const events = await supabaseActivity.list({ organizationId, limit });
    return buildRouteLedger(events);
  },

  /**
   * Take an ask back. Only a person with `projects.write` may withdraw, the
   * event is keyed on the route it withdraws, and from then on the ledger
   * refuses any acceptance the receiving room records.
   */
  async withdrawRoute(
    entry: RouteLedgerEntry,
    because: string,
    context: ProjectsContext,
    access: AccessContext | null | undefined,
  ): Promise<void> {
    if (!can(access, "projects.write")) {
      throw new Error("Your role can read Projects but not withdraw work it routed.");
    }
    if (entry.status === "accepted") {
      throw new Error(
        `${ROUTE_TARGET_LABEL[entry.targetApp]} has already accepted this. Talk to them rather than withdrawing it here.`,
      );
    }
    if (entry.status === "withdrawn") return;
    const reason = because.trim();
    if (!reason) throw new Error("Say why the ask is being taken back.");

    await emitSuiteEvent({
      key: "PROJECT_ROUTE_WITHDRAWN",
      organizationId: entry.organizationId,
      actor: {
        type: "user",
        id: context.userId,
        ...(context.userLabel ? { label: context.userLabel } : {}),
      },
      subject: { type: "project", id: entry.projectId, label: entry.projectName },
      summary: `${entry.projectName} withdrew its ask to ${ROUTE_TARGET_LABEL[entry.targetApp]}: ${entry.requestedOutcome}.`,
      sourceEventKey: `${entry.key}:withdrawn`,
      metadata: {
        route_event_key: entry.key,
        target_app: entry.targetApp,
        project_id: entry.projectId,
        because: reason,
        acceptance: "no_longer_acceptable",
      },
      confidence: "observed",
    });
  },

  /** Whether the receiving room may still record acceptance for a route. */
  acceptanceAllowed(entry: RouteLedgerEntry | undefined): boolean {
    return canAcceptRoute(entry);
  },
};

/**
 * Hand the request to the receiving room's inbox, when one is configured.
 * Ops is an external product and Studio is not built yet, so a missing
 * endpoint is an ordinary, recorded outcome — never a failed user action.
 */
async function notifyReceivingRoom(
  request: ProjectRouteRequest,
  context: ProjectsContext,
): Promise<void> {
  let delivered = false;
  let because = "No inbox is configured for that room yet, so nobody was notified.";
  try {
    const response = await fetch("/api/public/routing/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: request.organizationId,
        projectId: request.projectId,
        projectName: request.projectName,
        targetApp: request.targetApp,
        requestedOutcome: request.requestedOutcome,
        because: request.because,
        routeEventKey: request.sourceEventKey,
        requestedAt: request.requestedAt,
      }),
    });
    const body = (await response.json()) as { delivered?: boolean; because?: string };
    delivered = body.delivered === true;
    if (typeof body.because === "string" && body.because) because = body.because;
  } catch {
    because = "That room could not be reached just now. The request still stands.";
  }

  await emitSuiteEvent({
    key: "PROJECT_ROUTE_NOTIFIED",
    organizationId: request.organizationId,
    actor: {
      type: "user",
      id: context.userId,
      ...(context.userLabel ? { label: context.userLabel } : {}),
    },
    subject: { type: "project", id: request.projectId, label: request.projectName },
    summary: delivered
      ? `${ROUTE_TARGET_LABEL[request.targetApp]} was notified of the ask on ${request.projectName}.`
      : `${ROUTE_TARGET_LABEL[request.targetApp]} was not notified: ${because}`,
    sourceEventKey: `${request.sourceEventKey}:notified`,
    metadata: {
      route_event_key: request.sourceEventKey,
      target_app: request.targetApp,
      delivered,
      because,
    },
    confidence: "observed",
  });
}
