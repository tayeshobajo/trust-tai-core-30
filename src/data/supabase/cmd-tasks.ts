import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mayAddRequiredWork, RequiredWorkInput, requiredWorkKey, requiredMeetingId, type RequiredWorkDraft } from "@/domain/steward-required-work";
import { meetingAssociationIds, withMeetingAssociation } from "@/domain/steward-meeting-links";
import { supabase } from "@/integrations/trust-tai/supabase";
import {
  BoardTaskSchema,
  BoardEditSchema,
  type BoardEdit,
  type BoardTask,
  type TaskVisibility,
} from "@/domain/cmd-tasks";

const FIELDS =
  "id,organization_id,title,task_visibility,owner_user_id,owner_label,created_by,status,next_action,blocked_because,depends_on_task_id,parent_task_id,completion_evidence,completed_at,completed_by,archived_at,due_at,updated_at,revision,acceptance_criteria,context_links,notes,correlation_id";
function failure(error: { code?: string; message: string }): Error {
  if (["42703", "PGRST204", "PGRST202"].includes(error.code ?? ""))
    return new Error(
      "The task board is awaiting its approved database update. Existing Steward tasks are still available.",
    );
  return new Error(error.message);
}
/** All writes use the signed-in client. PostgreSQL RLS and immutable-field triggers are authoritative. */
export function boardService(client: SupabaseClient = supabase) {
  return {
    async createRequired(actor: { userId: string; organizationId: string; role: string }, input: RequiredWorkDraft): Promise<BoardTask> {
      const draft = RequiredWorkInput.parse(input);
      if (!mayAddRequiredWork(actor)) throw new Error("Task write access required.");
      const session = await client.auth.getUser();
      if (session.error || session.data.user?.id !== actor.userId) throw new Error("Sign in again before adding required work.");
      // Existing member RLS is authoritative for this narrow stored-meeting read and insertion.
      const meeting = await client.from("conversations").select("id").eq("organization_id", actor.organizationId).eq("id", draft.meetingId).single();
      if (meeting.error || !meeting.data) throw new Error("This stored meeting is unavailable in your workspace.");
      const key = requiredWorkKey(draft.meetingId, draft.operationId);
      return this.create(actor.organizationId, "business", key, {
        title: draft.title, status: "open", next_action: draft.nextAction, blocked_because: "",
        depends_on_task_id: null, parent_task_id: null, notes: null, due_at: null,
        owner_user_id: actor.userId, completion_evidence: "", acceptance_criteria: [],
        context_links: withMeetingAssociation([], draft.meetingId),
      });
    },
    async meetingOptions(
      org: string,
    ): Promise<{ meetings: { id: string; title: string }[]; truncated: boolean }> {
      const { data, error } = await client
        .from("conversations")
        .select("id,title")
        .eq("organization_id", org)
        .order("occurred_at", { ascending: false })
        .limit(61);
      if (error) throw failure(error);
      return { meetings: (data ?? []).slice(0, 60), truncated: (data ?? []).length > 60 };
    },
    async importPlannedWork(org: string): Promise<void> {
      const { error } = await client.rpc("cmd_import_approved_business_tasks", { target_org: org });
      if (error) throw failure(error);
    },
    async list(
      org: string,
      visibility: TaskVisibility,
    ): Promise<{ tasks: BoardTask[]; truncated: boolean }> {
      const { data, error } = await client
        .from("steward_tasks")
        .select(FIELDS)
        .eq("organization_id", org)
        .eq("task_visibility", visibility)
        .order("created_at", { ascending: false })
        .limit(1001);
      if (error) throw failure(error);
      return {
        tasks: (data ?? []).slice(0, 1000).map((v) => BoardTaskSchema.parse(v)),
        truncated: (data ?? []).length > 1000,
      };
    },
    async create(
      org: string,
      visibility: TaskVisibility,
      key: string,
      input: BoardEdit,
    ): Promise<BoardTask> {
      z.string().uuid().parse(org);
      z.enum(["business", "personal"]).parse(visibility);
      z.string().min(1).max(200).parse(key);
      const patch = BoardEditSchema.parse(input);
      const { data, error } = await client
        .from("steward_tasks")
        .insert({
          ...patch,
          organization_id: org,
          task_visibility: visibility,
          correlation_id: key,
          assignee_kind: "human",
          priority: "normal",
          source_app: visibility === "business" ? "cmd-business" : "cmd-personal",
          source_entity_type: "operational_task",
        })
        .select(FIELDS)
        .single();
      if (error?.code === "23505") {
        const existing = await client
          .from("steward_tasks")
          .select(FIELDS)
          .eq("organization_id", org)
          .eq("task_visibility", visibility)
          .eq("correlation_id", key)
          .single();
        if (existing.error) throw failure(existing.error);
        return BoardTaskSchema.parse(existing.data);
      }
      if (error) throw failure(error);
      return BoardTaskSchema.parse(data);
    },
    async update(task: BoardTask, input: BoardEdit): Promise<BoardTask> {
      const patch = BoardEditSchema.parse(input);
      const requiredId = requiredMeetingId(task);
      if (requiredId) {
        const original = task.context_links.filter((link) => meetingAssociationIds([link]).length > 0);
        const incoming = patch.context_links.filter((link) => meetingAssociationIds([link]).length > 0);
        if (JSON.stringify(original) !== JSON.stringify(incoming)) throw new Error("Required meeting scope is locked until audited scope changes are available.");
      }
      const { data, error } = await client
        .from("steward_tasks")
        .update(patch)
        .eq("id", task.id)
        .eq("organization_id", task.organization_id)
        .eq("task_visibility", task.task_visibility)
        .eq("revision", task.revision)
        .select(FIELDS)
        .maybeSingle();
      if (error) throw failure(error);
      if (!data)
        throw new Error(
          "This task changed or you no longer have access. Refresh before saving again.",
        );
      return BoardTaskSchema.parse(data);
    },
    async archive(task: BoardTask, archived: boolean): Promise<void> {
      const { data, error } = await client
        .from("steward_tasks")
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("id", task.id)
        .eq("organization_id", task.organization_id)
        .eq("revision", task.revision)
        .select("id")
        .maybeSingle();
      if (error) throw failure(error);
      if (!data)
        throw new Error(
          "This task changed or you no longer have access. Refresh before trying again.",
        );
    },
    async personalCounts(
      org: string,
    ): Promise<{ owner_user_id: string; status: string; task_count: number }[]> {
      const { data, error } = await client.rpc("cmd_personal_task_counts", { target_org: org });
      if (error) throw failure(error);
      return data ?? [];
    },
  };
}
export const cmdTasks = boardService();

/** Share the board cache only within the same authenticated organization/user. */
export function businessWorkQuery(org: string, userId: string) {
  return {
    queryKey: ["cmd-tasks", org, userId, "business"] as const,
    queryFn: () => cmdTasks.list(org, "business"),
  };
}
