import type { SupabaseClient } from "@supabase/supabase-js";
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
