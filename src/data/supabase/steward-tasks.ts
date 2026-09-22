/**
 * Manual Steward tasks.
 *
 * A task a person creates directly in Steward, rather than one derived from a
 * meeting promise, a project work item, or a Paperclip agent. It reads and
 * writes the public.steward_tasks table and projects into the same
 * accountability checklist as everything else.
 *
 * The table is optional. When it has not been applied yet the list reads empty
 * and creating one says plainly that it needs provisioning first.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  ManualAiMode,
  ManualAssigneeKind,
  ManualContextLink,
  ManualSubtask,
  ManualTaskPriority,
  ManualTaskRecord,
} from "@/domain/steward-accountability";

import type { Row } from "./schema";

const NOT_PROVISIONED = /does not exist|schema cache|42P01|PGRST205|PGRST20[0-9]/i;

export class ManualTasksNotProvisionedError extends Error {
  constructor() {
    super(
      "Steward's manual tasks table is not in this workspace yet. Apply docs/steward-manual-tasks-schema.sql, then reload.",
    );
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asSubtasks(value: unknown): ManualSubtask[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      return {
        id: String(record["id"] ?? ""),
        text: String(record["text"] ?? ""),
        done: Boolean(record["done"]),
      };
    })
    .filter((entry): entry is ManualSubtask => entry !== null);
}

function asCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter(Boolean);
}

function asLinks(value: unknown): ManualContextLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const label = String(record["label"] ?? "");
      const url = String(record["url"] ?? "");
      if (!label && !url) return null;
      const kind = str(record["kind"]);
      return { label, url, ...(kind ? { kind } : {}) };
    })
    .filter((entry): entry is ManualContextLink => entry !== null);
}

function toRecord(row: Row): ManualTaskRecord {
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    title: String(row["title"] ?? ""),
    ...(str(row["client_id"]) ? { clientId: str(row["client_id"])! } : {}),
    ...(str(row["client_label"]) ? { clientLabel: str(row["client_label"])! } : {}),
    ...(str(row["project_id"]) ? { projectId: str(row["project_id"])! } : {}),
    ...(str(row["project_label"]) ? { projectLabel: str(row["project_label"])! } : {}),
    ...(str(row["due_at"]) ? { dueAt: str(row["due_at"])! } : {}),
    ...(str(row["owner_user_id"]) ? { ownerUserId: str(row["owner_user_id"])! } : {}),
    ...(str(row["owner_label"]) ? { ownerLabel: str(row["owner_label"])! } : {}),
    priority: (str(row["priority"]) ?? "normal") as ManualTaskPriority,
    assigneeKind: (str(row["assignee_kind"]) ?? "human") as ManualAssigneeKind,
    ...(str(row["ai_mode"]) ? { aiMode: str(row["ai_mode"]) as ManualAiMode } : {}),
    status: (str(row["status"]) ?? "open") as ManualTaskRecord["status"],
    subtasks: asSubtasks(row["subtasks"]),
    acceptanceCriteria: asCriteria(row["acceptance_criteria"]),
    contextLinks: asLinks(row["context_links"]),
    ...(str(row["notes"]) ? { notes: str(row["notes"])! } : {}),
    ...(str(row["paperclip_task_id"]) ? { paperclipTaskId: str(row["paperclip_task_id"])! } : {}),
    ...(str(row["correlation_id"]) ? { correlationId: str(row["correlation_id"])! } : {}),
    ...(str(row["created_by"]) ? { createdBy: str(row["created_by"])! } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

/** The typed input for creating a manual task. Only title is required. */
export interface CreateManualTaskInput {
  organizationId: ID;
  title: string;
  clientId?: ID | null;
  clientLabel?: string | null;
  projectId?: ID | null;
  projectLabel?: string | null;
  dueAt?: string | null;
  ownerUserId?: ID | null;
  ownerLabel?: string | null;
  priority?: ManualTaskPriority;
  assigneeKind?: ManualAssigneeKind;
  aiMode?: ManualAiMode | null;
  status?: ManualTaskRecord["status"];
  subtasks?: ManualSubtask[];
  acceptanceCriteria?: string[];
  contextLinks?: ManualContextLink[];
  notes?: string | null;
  createdBy?: ID | null;
  correlationId?: string | null;
}

/** A patch for updating a manual task. Only supplied keys are written. */
export interface UpdateManualTaskPatch {
  title?: string;
  clientId?: ID | null;
  clientLabel?: string | null;
  projectId?: ID | null;
  projectLabel?: string | null;
  dueAt?: string | null;
  ownerUserId?: ID | null;
  ownerLabel?: string | null;
  priority?: ManualTaskPriority;
  assigneeKind?: ManualAssigneeKind;
  aiMode?: ManualAiMode | null;
  status?: ManualTaskRecord["status"];
  subtasks?: ManualSubtask[];
  acceptanceCriteria?: string[];
  contextLinks?: ManualContextLink[];
  notes?: string | null;
  paperclipTaskId?: string | null;
  correlationId?: string | null;
}

export const stewardTasks = {
  /** Read every manual task for this workspace. Missing table reads empty. */
  async list(organizationId: ID): Promise<ManualTaskRecord[]> {
    const { data, error } = await supabase
      .from("steward_tasks")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) return [];
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => toRecord(row as Row));
  },

  async provisioned(organizationId: ID): Promise<boolean> {
    const { error } = await supabase
      .from("steward_tasks")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1);
    if (!error) return true;
    return !NOT_PROVISIONED.test(`${error.code} ${error.message}`);
  },

  /** Create one task. Only the keys provided are set; the table defaults the rest. */
  async create(input: CreateManualTaskInput): Promise<ManualTaskRecord> {
    const payload: Row = {
      organization_id: input.organizationId,
      title: input.title,
    };
    if (input.clientId !== undefined) payload["client_id"] = input.clientId;
    if (input.clientLabel !== undefined) payload["client_label"] = input.clientLabel;
    if (input.projectId !== undefined) payload["project_id"] = input.projectId;
    if (input.projectLabel !== undefined) payload["project_label"] = input.projectLabel;
    if (input.dueAt !== undefined) payload["due_at"] = input.dueAt;
    if (input.ownerUserId !== undefined) payload["owner_user_id"] = input.ownerUserId;
    if (input.ownerLabel !== undefined) payload["owner_label"] = input.ownerLabel;
    if (input.priority !== undefined) payload["priority"] = input.priority;
    if (input.assigneeKind !== undefined) payload["assignee_kind"] = input.assigneeKind;
    if (input.aiMode !== undefined) payload["ai_mode"] = input.aiMode;
    if (input.status !== undefined) payload["status"] = input.status;
    if (input.subtasks !== undefined) payload["subtasks"] = input.subtasks;
    if (input.acceptanceCriteria !== undefined)
      payload["acceptance_criteria"] = input.acceptanceCriteria;
    if (input.contextLinks !== undefined) payload["context_links"] = input.contextLinks;
    if (input.notes !== undefined) payload["notes"] = input.notes;
    if (input.createdBy !== undefined) payload["created_by"] = input.createdBy;
    if (input.correlationId !== undefined) payload["correlation_id"] = input.correlationId;

    const { data, error } = await supabase
      .from("steward_tasks")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) {
        throw new ManualTasksNotProvisionedError();
      }
      throw new Error(error.message);
    }
    return toRecord((data ?? {}) as Row);
  },

  /** Update one task by id. Only supplied keys are written; updated_at is set. */
  async update(id: ID, patch: UpdateManualTaskPatch): Promise<ManualTaskRecord> {
    const payload: Row = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) payload["title"] = patch.title;
    if (patch.clientId !== undefined) payload["client_id"] = patch.clientId;
    if (patch.clientLabel !== undefined) payload["client_label"] = patch.clientLabel;
    if (patch.projectId !== undefined) payload["project_id"] = patch.projectId;
    if (patch.projectLabel !== undefined) payload["project_label"] = patch.projectLabel;
    if (patch.dueAt !== undefined) payload["due_at"] = patch.dueAt;
    if (patch.ownerUserId !== undefined) payload["owner_user_id"] = patch.ownerUserId;
    if (patch.ownerLabel !== undefined) payload["owner_label"] = patch.ownerLabel;
    if (patch.priority !== undefined) payload["priority"] = patch.priority;
    if (patch.assigneeKind !== undefined) payload["assignee_kind"] = patch.assigneeKind;
    if (patch.aiMode !== undefined) payload["ai_mode"] = patch.aiMode;
    if (patch.status !== undefined) payload["status"] = patch.status;
    if (patch.subtasks !== undefined) payload["subtasks"] = patch.subtasks;
    if (patch.acceptanceCriteria !== undefined)
      payload["acceptance_criteria"] = patch.acceptanceCriteria;
    if (patch.contextLinks !== undefined) payload["context_links"] = patch.contextLinks;
    if (patch.notes !== undefined) payload["notes"] = patch.notes;
    if (patch.paperclipTaskId !== undefined) payload["paperclip_task_id"] = patch.paperclipTaskId;
    if (patch.correlationId !== undefined) payload["correlation_id"] = patch.correlationId;

    const { data, error } = await supabase
      .from("steward_tasks")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) {
        throw new ManualTasksNotProvisionedError();
      }
      throw new Error(error.message);
    }
    return toRecord((data ?? {}) as Row);
  },
};
