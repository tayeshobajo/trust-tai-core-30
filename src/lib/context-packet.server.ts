/**
 * The Project Context Packet, read on the server.
 *
 * This is the one read contract an outside agent runtime (OpenClaw, Paperclip)
 * is allowed to use to understand a project. It is generated from current
 * project state on every request, never stored, and never a second document a
 * person has to maintain.
 *
 * Everything is read under the caller's own Supabase session, so row level
 * security decides what the packet can contain. A token alone is not access:
 * the caller must also be an active member of the organization.
 *
 * What the packet never carries: transcripts, raw files, every attachment,
 * unconfirmed knowledge presented as truth, or anything from an organization
 * the caller is not a member of.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  buildProjectContextPacket,
  contextHealth,
  type ContextHealth,
  type ProjectContextPacket,
} from "@/data/projects/context-packet";
import type { ProjectBlocker, ProjectDecision, WorkItem } from "@/domain/project-delivery";
import type {
  KnowledgeItem,
  ProjectAsset,
  ProjectConnection,
  ThinkingSource,
} from "@/domain/project-intelligence";
import type { ExecutionProject, ExecutionState } from "@/domain/projects";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

type Row = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Read the caller's bearer token. No token, no packet. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export function clientForToken(token: string): SupabaseClient {
  const key = trustTaiSupabaseKey();
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
  });
}

export interface CallerIdentity {
  userId: string;
  organizationId: string;
}

/** A valid token is never enough on its own. Active membership decides. */
export async function requireMember(
  supabase: SupabaseClient,
  token: string,
  organizationId: string,
): Promise<CallerIdentity | null> {
  if (!organizationId) return null;
  const { data: userData } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (!user) return null;
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("organization_id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .limit(1);
  if (error) return null;
  const active = (data ?? []).some((row) => ((row as Row)["status"] ?? "active") === "active");
  return active ? { userId: user.id, organizationId } : null;
}

/* ------------------------------------------------------------- mapping */

const LIFECYCLE: Record<string, ExecutionState> = {
  ready: "ready",
  in_progress: "in_progress",
  blocked: "blocked",
  waiting: "waiting",
  in_review: "in_review",
  complete: "complete",
};

function toProjectRow(row: Row): ExecutionProject {
  const meta =
    row["metadata"] && typeof row["metadata"] === "object" && !Array.isArray(row["metadata"])
      ? (row["metadata"] as Row)
      : {};
  const state =
    (str(meta["execution_state"]) as ExecutionState | undefined) ??
    LIFECYCLE[String(row["status"] ?? "")] ??
    "ready";
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    name: String(row["name"] ?? row["title"] ?? "Untitled project"),
    state,
    ...(str(meta["owner_label"]) ? { ownerLabel: String(meta["owner_label"]) } : {}),
    ...(str(row["owner_user_id"]) ? { ownerUserId: String(row["owner_user_id"]) } : {}),
    pointA: String(row["point_a"] ?? meta["point_a"] ?? ""),
    pointB: String(row["point_b"] ?? meta["point_b"] ?? ""),
    ...(str(row["due_date"]) || str(meta["due_date"])
      ? { dueDate: String(row["due_date"] ?? meta["due_date"]) }
      : {}),
    deliveryItems: [],
    evidence: [],
    dependencies: [],
    origin: {
      kind:
        (meta["origin"] as Row | undefined)?.["kind"] === "roadmap_milestone"
          ? "roadmap_milestone"
          : "manual",
      ...(str((meta["origin"] as Row | undefined)?.["roadmapId"])
        ? { roadmapId: String((meta["origin"] as Row)["roadmapId"]) }
        : {}),
      ...(str((meta["origin"] as Row | undefined)?.["milestoneId"])
        ? { milestoneId: String((meta["origin"] as Row)["milestoneId"]) }
        : {}),
      ...(str((meta["origin"] as Row | undefined)?.["subjectLabel"])
        ? { subjectLabel: String((meta["origin"] as Row)["subjectLabel"]) }
        : {}),
    },
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  } as ExecutionProject;
}

function toKnowledgeRow(row: Row): KnowledgeItem {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    section: (str(row["section"]) as KnowledgeItem["section"]) ?? "reference",
    body: String(row["body"] ?? ""),
    origin: (str(row["origin"]) as KnowledgeItem["origin"]) ?? "human",
    reviewState: (str(row["review_state"]) as KnowledgeItem["reviewState"]) ?? "needs_review",
    ...(str(row["source_reference"]) ? { sourceReference: String(row["source_reference"]) } : {}),
    ...(str(row["source_label"]) ? { sourceLabel: String(row["source_label"]) } : {}),
    ...(typeof row["confidence"] === "number" ? { confidence: row["confidence"] as number } : {}),
    capturedAt: String(row["captured_at"] ?? new Date().toISOString()),
  };
}

function toWorkRow(row: Row): WorkItem {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    title: String(row["title"] ?? "Untitled work"),
    status: (str(row["status"]) as WorkItem["status"]) ?? "ready",
    ...(str(row["owner_label"]) ? { ownerLabel: String(row["owner_label"]) } : {}),
    ...(str(row["due_date"]) ? { dueDate: String(row["due_date"]) } : {}),
    sequence: Number(row["sequence"] ?? 0),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

function toBlockerRow(row: Row): ProjectBlocker {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    reason: String(row["reason"] ?? ""),
    ...(str(row["owner_label"]) ? { ownerLabel: String(row["owner_label"]) } : {}),
    status: row["status"] === "resolved" ? "resolved" : "open",
    raisedAt: String(row["raised_at"] ?? row["created_at"] ?? new Date().toISOString()),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toDecisionRow(row: Row): ProjectDecision {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    question: String(row["question"] ?? ""),
    status: row["status"] === "answered" ? "answered" : "open",
    ...(str(row["answer"]) ? { answer: String(row["answer"]) } : {}),
    ...(str(row["decided_at"]) ? { decidedAt: String(row["decided_at"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toAssetRow(row: Row): ProjectAsset {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    fileId: String(row["file_id"] ?? ""),
    assetType: (str(row["asset_type"]) as ProjectAsset["assetType"]) ?? "other",
    title: String(row["title"] ?? "Untitled asset"),
    version: Number(row["version"] ?? 1),
    status: (str(row["status"]) as ProjectAsset["status"]) ?? "draft",
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

function toConnectionRow(row: Row): ProjectConnection {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    connectionType: (str(row["connection_type"]) as ProjectConnection["connectionType"]) ?? "other",
    label: String(row["label"] ?? ""),
    ...(str(row["url"]) ? { url: String(row["url"]) } : {}),
    status: (str(row["status"]) as ProjectConnection["status"]) ?? "linked",
    ...(str(row["last_synced_at"]) ? { lastSyncedAt: String(row["last_synced_at"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toThinkingRow(row: Row): ThinkingSource {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    sourceType: (str(row["source_type"]) as ThinkingSource["sourceType"]) ?? "other",
    title: String(row["title"] ?? "Untitled source"),
    url: String(row["url"] ?? ""),
    isPrimary: row["is_primary"] === true,
    syncState: (str(row["sync_state"]) as ThinkingSource["syncState"]) ?? "link_saved",
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

/* --------------------------------------------------------------- the read */

export class PacketNotFoundError extends Error {}

export interface PacketResult {
  packet: ProjectContextPacket;
  health: ContextHealth;
}

/**
 * Generate the packet for one project, optionally on behalf of one agent.
 *
 * When an agent is named and a person has written its effectiveness
 * definition, the packet carries that agent's boundaries: what it is
 * responsible for, what context it must have, when it must escalate, and what
 * it must not change. An agent with no definition gets context and no
 * authority, which is the safe direction for a mistake to fall.
 */
export async function readContextPacket(
  supabase: SupabaseClient,
  input: { organizationId: string; projectId: string; agentId?: string | null },
): Promise<PacketResult> {
  const { organizationId, projectId } = input;

  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!projectRow) throw new PacketNotFoundError("No project with that id is readable to you.");

  const project = toProjectRow(projectRow as Row);

  const scoped = (table: string) =>
    supabase
      .from(table)
      .select("*")
      .eq("organization_id", organizationId)
      .eq("project_id", projectId);

  const [knowledge, work, blockers, decisions, assets, connections, thinking] = await Promise.all([
    scoped("project_knowledge"),
    scoped("project_work_items"),
    scoped("project_blockers"),
    scoped("project_decisions"),
    scoped("project_assets"),
    scoped("project_connections"),
    scoped("project_thinking_sources"),
  ]);

  // Lineage: the milestone name is roadmap truth, so it is read from the
  // roadmap, never copied into the project.
  let milestoneName: string | undefined;
  const milestoneId = project.origin.milestoneId;
  if (milestoneId) {
    const { data: stage } = await supabase
      .from("roadmap_stages")
      .select("title")
      .eq("id", milestoneId)
      .maybeSingle();
    milestoneName = str((stage as Row | null)?.["title"]);
  }

  let agent: Parameters<typeof buildProjectContextPacket>[0]["agent"];
  if (input.agentId) {
    const { data: definition } = await supabase
      .from("agent_effectiveness")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("agent_id", input.agentId)
      .maybeSingle();
    const row = (definition ?? null) as Row | null;
    agent = {
      agentId: input.agentId,
      responsibility: row ? String(row["responsibility"] ?? "") : "",
      requiredContext: strings(row?.["required_context"]),
      escalationRules: strings(row?.["escalation_rules"]),
      evidenceExpected: strings(row?.["evidence_expected"]),
    };
  }

  const packet = buildProjectContextPacket({
    project,
    ...(project.origin.subjectLabel ? { company: project.origin.subjectLabel } : {}),
    roadmap: {
      ...(project.origin.roadmapId ? { roadmapId: project.origin.roadmapId } : {}),
      ...(milestoneId ? { milestoneId } : {}),
      ...(milestoneName ? { milestoneName } : {}),
    },
    knowledge: ((knowledge.data ?? []) as Row[]).map(toKnowledgeRow),
    decisions: ((decisions.data ?? []) as Row[]).map(toDecisionRow),
    blockers: ((blockers.data ?? []) as Row[]).map(toBlockerRow),
    work: ((work.data ?? []) as Row[]).map(toWorkRow),
    assets: ((assets.data ?? []) as Row[]).map(toAssetRow),
    connections: ((connections.data ?? []) as Row[]).map(toConnectionRow),
    thinking: ((thinking.data ?? []) as Row[]).map(toThinkingRow),
    ...(agent ? { agent } : {}),
  });

  const hasDesignWork = packet.approvedAssets.some(
    (asset) => asset.assetType === "mockup" || asset.assetType === "design_reference",
  );

  return { packet, health: contextHealth(packet, hasDesignWork) };
}
