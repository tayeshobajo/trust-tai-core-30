/**
 * Projects delivery service — work items, blockers, decisions and files.
 *
 * Everything is scoped by organization and project, read under the person's
 * own access, and mirrored into the shared `activities` stream so Home, Pulse
 * and Ask Trust Tai read the same history. Files live in the private
 * `project-files` bucket and are only ever handed out as short signed urls.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ActivityName } from "@/domain/activity";
import type { ID } from "@/domain/entities";
import {
  PROJECT_FILES_BUCKET,
  projectFilePath,
  type BlockerInput,
  type ProjectBlocker,
  type ProjectDecision,
  type ProjectDecisionInput,
  type ProjectFile,
  type ProjectFileKind,
  type WorkItem,
  type WorkItemInput,
  type WorkItemStatus,
} from "@/domain/project-delivery";

import { supabaseActivity } from "./activities";
import type { Row } from "./schema";

export interface DeliveryContext {
  organizationId: ID;
  projectId: ID;
  projectName: string;
  userId: ID;
  userLabel?: string | undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function record(
  context: DeliveryContext,
  name: ActivityName,
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const at = new Date().toISOString();
  try {
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name,
      subject: { type: "project", id: context.projectId, label: context.projectName },
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

function fail(message: string, error: { message: string } | null): never {
  throw new Error(error?.message ? `${message} ${error.message}` : message);
}

/* -------------------------------------------------------------- work items */

function toWorkItem(row: Row): WorkItem {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    title: String(row["title"] ?? "Untitled work"),
    ...(str(row["description"]) ? { description: String(row["description"]) } : {}),
    status: (str(row["status"]) as WorkItemStatus | undefined) ?? "ready",
    ...(str(row["owner_user_id"]) ? { ownerUserId: String(row["owner_user_id"]) } : {}),
    ...(str(row["owner_label"]) ? { ownerLabel: String(row["owner_label"]) } : {}),
    ...(str(row["due_date"]) ? { dueDate: String(row["due_date"]) } : {}),
    ...(str(row["started_at"]) ? { startedAt: String(row["started_at"]) } : {}),
    ...(str(row["completed_at"]) ? { completedAt: String(row["completed_at"]) } : {}),
    sequence: Number(row["sequence"] ?? 0),
    ...(str(row["review_state"]) ? { reviewState: String(row["review_state"]) } : {}),
    ...(str(row["depends_on"]) ? { dependsOn: String(row["depends_on"]) } : {}),
    ...(str(row["milestone_id"]) ? { milestoneId: String(row["milestone_id"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

function toBlocker(row: Row): ProjectBlocker {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    ...(str(row["work_item_id"]) ? { workItemId: String(row["work_item_id"]) } : {}),
    reason: String(row["reason"] ?? ""),
    ...(str(row["impact"]) ? { impact: String(row["impact"]) } : {}),
    ...(str(row["owner_label"]) ? { ownerLabel: String(row["owner_label"]) } : {}),
    ...(str(row["next_move"]) ? { nextMove: String(row["next_move"]) } : {}),
    status: row["status"] === "resolved" ? "resolved" : "open",
    raisedAt: String(row["raised_at"] ?? row["created_at"] ?? new Date().toISOString()),
    ...(str(row["resolved_at"]) ? { resolvedAt: String(row["resolved_at"]) } : {}),
    ...(str(row["resolution"]) ? { resolution: String(row["resolution"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toDecision(row: Row): ProjectDecision {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    ...(str(row["work_item_id"]) ? { workItemId: String(row["work_item_id"]) } : {}),
    question: String(row["question"] ?? ""),
    ...(str(row["why_it_matters"]) ? { whyItMatters: String(row["why_it_matters"]) } : {}),
    ...(str(row["owner_label"]) ? { ownerLabel: String(row["owner_label"]) } : {}),
    status: row["status"] === "answered" ? "answered" : "open",
    ...(str(row["answer"]) ? { answer: String(row["answer"]) } : {}),
    ...(str(row["decided_at"]) ? { decidedAt: String(row["decided_at"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

function toFile(row: Row): ProjectFile {
  const kind = str(row["kind"]) as ProjectFileKind | undefined;
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    projectId: String(row["project_id"] ?? ""),
    ...(str(row["work_item_id"]) ? { workItemId: String(row["work_item_id"]) } : {}),
    name: String(row["name"] ?? "File"),
    kind: kind ?? "reference",
    storagePath: String(row["storage_path"] ?? ""),
    ...(str(row["content_type"]) ? { contentType: String(row["content_type"]) } : {}),
    ...(row["size_bytes"] != null ? { sizeBytes: Number(row["size_bytes"]) } : {}),
    ...(str(row["uploaded_by_label"]) ? { uploadedByLabel: String(row["uploaded_by_label"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

export const projectDelivery = {
  /* ------------------------------------------------------------ work items */

  async listWork(context: DeliveryContext): Promise<WorkItem[]> {
    const { data, error } = await supabase
      .from("project_work_items")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("sequence", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) fail("The work list could not be read.", error);
    return (data ?? []).map((row) => toWorkItem(row as Row));
  },

  async addWork(input: WorkItemInput, context: DeliveryContext): Promise<WorkItem> {
    const { data, error } = await supabase
      .from("project_work_items")
      .insert({
        organization_id: context.organizationId,
        project_id: context.projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "ready",
        owner_label: input.ownerLabel ?? null,
        owner_user_id: input.ownerUserId ?? null,
        due_date: input.dueDate ?? null,
        sequence: input.sequence ?? 0,
        depends_on: input.dependsOn ?? null,
        milestone_id: input.milestoneId ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error || !data) fail("That work item could not be added.", error);
    const item = toWorkItem(data as Row);
    await record(context, "project.next_move_changed", `${item.title} was added to the work list.`, {
      work_item_id: item.id,
    });
    return item;
  },

  async moveWork(
    item: WorkItem,
    status: WorkItemStatus,
    context: DeliveryContext,
  ): Promise<WorkItem> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("project_work_items")
      .update({
        status,
        updated_at: now,
        ...(status === "in_progress" && !item.startedAt ? { started_at: now } : {}),
        completed_at: status === "complete" ? now : null,
      })
      .eq("id", item.id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    if (error || !data) fail("That work item could not be moved.", error);
    const saved = toWorkItem(data as Row);
    await record(
      context,
      "project.status_changed",
      `${saved.title} moved to ${status.replace(/_/g, " ")}.`,
      { work_item_id: saved.id, from: item.status, to: status },
    );
    return saved;
  },

  /* -------------------------------------------------------------- blockers */

  async listBlockers(context: DeliveryContext): Promise<ProjectBlocker[]> {
    const { data, error } = await supabase
      .from("project_blockers")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("raised_at", { ascending: false });
    if (error) fail("The blocker register could not be read.", error);
    return (data ?? []).map((row) => toBlocker(row as Row));
  },

  async raiseBlocker(input: BlockerInput, context: DeliveryContext): Promise<ProjectBlocker> {
    const { data, error } = await supabase
      .from("project_blockers")
      .insert({
        organization_id: context.organizationId,
        project_id: context.projectId,
        work_item_id: input.workItemId ?? null,
        reason: input.reason,
        impact: input.impact ?? null,
        owner_label: input.ownerLabel ?? null,
        next_move: input.nextMove ?? null,
        status: "open",
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error || !data) fail("That blocker could not be recorded.", error);
    const blocker = toBlocker(data as Row);
    await record(context, "project.blocked", `Blocked: ${blocker.reason}`, {
      blocker_id: blocker.id,
    });
    return blocker;
  },

  async resolveBlocker(
    blocker: ProjectBlocker,
    resolution: string,
    context: DeliveryContext,
  ): Promise<ProjectBlocker> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("project_blockers")
      .update({
        status: "resolved",
        resolved_at: now,
        resolution: resolution || null,
        updated_at: now,
      })
      .eq("id", blocker.id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    if (error || !data) fail("That blocker could not be resolved.", error);
    const saved = toBlocker(data as Row);
    await record(context, "project.status_changed", `Blocker cleared: ${saved.reason}`, {
      blocker_id: saved.id,
    });
    return saved;
  },

  /* ------------------------------------------------------------- decisions */

  async listDecisions(context: DeliveryContext): Promise<ProjectDecision[]> {
    const { data, error } = await supabase
      .from("project_decisions")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("created_at", { ascending: false });
    if (error) fail("The decisions could not be read.", error);
    return (data ?? []).map((row) => toDecision(row as Row));
  },

  async askDecision(
    input: ProjectDecisionInput,
    context: DeliveryContext,
  ): Promise<ProjectDecision> {
    const { data, error } = await supabase
      .from("project_decisions")
      .insert({
        organization_id: context.organizationId,
        project_id: context.projectId,
        work_item_id: input.workItemId ?? null,
        question: input.question,
        why_it_matters: input.whyItMatters ?? null,
        owner_label: input.ownerLabel ?? null,
        status: "open",
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error || !data) fail("That decision could not be recorded.", error);
    const decision = toDecision(data as Row);
    await record(context, "decision_requested", `Decision needed: ${decision.question}`, {
      decision_id: decision.id,
    });
    return decision;
  },

  async answerDecision(
    decision: ProjectDecision,
    answer: string,
    context: DeliveryContext,
  ): Promise<ProjectDecision> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("project_decisions")
      .update({ status: "answered", answer, decided_at: now, updated_at: now })
      .eq("id", decision.id)
      .eq("organization_id", context.organizationId)
      .select("*")
      .single();
    if (error || !data) fail("That answer could not be saved.", error);
    const saved = toDecision(data as Row);
    await record(context, "decision_resolved", `Decided: ${saved.question}`, {
      decision_id: saved.id,
    });
    return saved;
  },

  /* ----------------------------------------------------------------- files */

  async listFiles(context: DeliveryContext): Promise<ProjectFile[]> {
    const { data, error } = await supabase
      .from("project_files")
      .select("*")
      .eq("organization_id", context.organizationId)
      .eq("project_id", context.projectId)
      .order("created_at", { ascending: false });
    if (error) fail("The project files could not be read.", error);
    return (data ?? []).map((row) => toFile(row as Row));
  },

  async uploadFile(
    file: File,
    options: { kind: ProjectFileKind; workItemId?: ID },
    context: DeliveryContext,
  ): Promise<ProjectFile> {
    const path = projectFilePath(context.organizationId, context.projectId, file.name);
    const upload = await supabase.storage
      .from(PROJECT_FILES_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (upload.error) fail("That file could not be uploaded.", upload.error);

    const { data, error } = await supabase
      .from("project_files")
      .insert({
        organization_id: context.organizationId,
        project_id: context.projectId,
        work_item_id: options.workItemId ?? null,
        name: file.name,
        kind: options.kind,
        storage_path: path,
        content_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: context.userId,
        uploaded_by_label: context.userLabel ?? null,
      })
      .select("*")
      .single();
    if (error || !data) {
      // Never leave an orphan object behind when the record could not be written.
      await supabase.storage.from(PROJECT_FILES_BUCKET).remove([path]);
      fail("That file was uploaded but could not be recorded.", error);
    }
    const saved = toFile(data as Row);
    await record(context, "project.next_move_changed", `${saved.name} was added to the project.`, {
      file_id: saved.id,
      kind: saved.kind,
    });
    return saved;
  },

  /** A short-lived signed url. Files are private; nothing is ever public. */
  async fileUrl(file: ProjectFile, download = false): Promise<string> {
    const { data, error } = await supabase.storage
      .from(PROJECT_FILES_BUCKET)
      .createSignedUrl(file.storagePath, 60, download ? { download: file.name } : {});
    if (error || !data?.signedUrl) fail("That file could not be opened.", error);
    return data.signedUrl;
  },
};
