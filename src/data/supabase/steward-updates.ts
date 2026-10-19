import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { Commitment } from "@/domain/steward";
import { BOARD_WRITE_ROLES } from "@/domain/cmd-tasks";
import { z } from "zod";

const Input = z.object({
  organizationId: z.string().uuid(),
  taskId: z.string().uuid(),
  kind: z.enum(["commitment", "business-task", "required-task"]),
  meetingId: z.string().uuid(),
  operationId: z.string().uuid(),
  note: z.string().trim().min(1).max(4000),
  authorName: z.string().max(200),
  laterMeetingId: z.string().uuid().nullable(),
  laterDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  originalDue: z.string().nullable(),
  action: z.enum(["update", "roll_forward"]),
});
export type StewardUpdateInput = z.infer<typeof Input>;
export interface StewardUpdate {
  id: string;
  entity_id: string;
  actor_user_id: string;
  occurred_at: string;
  summary: string;
  payload: {
    note?: string;
    author_name?: string;
    action?: string;
    later_date?: string | null;
    later_meeting_id?: string | null;
    original_meeting_id?: string;
    task_kind?: string;
  };
}

/** Strict writes to the existing activity contract. Never drop attribution or payload on schema mismatch. */
export function stewardUpdates(client: SupabaseClient = supabase) {
  return {
    async setCommitmentStatus(
      commitment: Commitment,
      status: "open" | "waiting" | "kept",
      note: string,
      authorName: string,
    ): Promise<void> {
      if (commitment.status === "kept")
        throw new Error(
          "This commitment is already complete. Post an update instead of repeating completion.",
        );
      if (!["open", "waiting", "kept"].includes(status))
        throw new Error("Choose a supported status.");
      if (status === "kept" && note.trim().length < 10)
        throw new Error("Record the result and supporting evidence.");
      const auth = await client.auth.getUser();
      if (auth.error || !auth.data.user) throw new Error("Sign in before changing work.");
      const membership = await client
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", commitment.organizationId)
        .eq("user_id", auth.data.user.id)
        .eq("status", "active")
        .single();
      if (
        membership.error ||
        !membership.data ||
        !BOARD_WRITE_ROLES.includes(membership.data.role) ||
        commitment.projectId ||
        (!["owner", "admin"].includes(membership.data.role) &&
          commitment.ownerUserId !== auth.data.user.id)
      )
        throw new Error("Only the authorized owner or manager can change this commitment.");
      const result = await client
        .from("commitments")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", commitment.id)
        .eq("organization_id", commitment.organizationId)
        .eq("updated_at", commitment.updatedAt)
        .eq("status", commitment.status)
        .select("id")
        .maybeSingle();
      if (result.error || !result.data)
        throw new Error(
          result.error?.message ||
            "This commitment changed or access was removed. Refresh before trying again.",
        );
      if (status === "kept") {
        try {
          await this.post({
            organizationId: commitment.organizationId,
            taskId: commitment.id,
            kind: "commitment",
            meetingId: commitment.conversationId,
            operationId: crypto.randomUUID(),
            note,
            authorName,
            laterDate: null,
            laterMeetingId: null,
            originalDue: commitment.dueAt ?? null,
            action: "update",
          });
        } catch {
          throw new Error(
            "Completion was saved, but its update could not be recorded. Review the completed task and post the evidence as an update; do not repeat completion.",
          );
        }
      }
    },
    async forwards(
      org: string,
      ids: string[],
    ): Promise<{ events: StewardUpdate[]; truncated: boolean }> {
      const events: StewardUpdate[] = [];
      let truncated = false;
      for (let i = 0; i < ids.length; i += 100) {
        const result = await client
          .from("activities")
          .select("id,entity_id,actor_user_id,occurred_at,summary,payload")
          .eq("organization_id", org)
          .eq("app_key", "steward")
          .eq("entity_type", "task")
          .eq("payload->>action", "roll_forward")
          .in("entity_id", ids.slice(i, i + 100))
          .order("occurred_at", { ascending: false })
          .limit(501);
        if (result.error) throw new Error(result.error.message);
        truncated ||= (result.data?.length ?? 0) > 500;
        events.push(...(result.data ?? []).slice(0, 500));
      }
      return {
        events: events.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
        truncated,
      };
    },
    async list(org: string, taskId: string): Promise<StewardUpdate[]> {
      const { data, error } = await client
        .from("activities")
        .select("id,entity_id,actor_user_id,occurred_at,summary,payload")
        .eq("organization_id", org)
        .eq("app_key", "steward")
        .eq("entity_type", "task")
        .eq("entity_id", taskId)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async post(value: StewardUpdateInput): Promise<void> {
      const input = Input.parse(value);
      const auth = await client.auth.getUser();
      if (auth.error || !auth.data.user) throw new Error("Sign in before posting an update.");
      // Re-read through the SAME signed-in RLS client before writing history. Never log private board work to shared activity.
      const table = input.kind === "commitment" ? "commitments" : "steward_tasks";
      let read = client
        .from(table)
        .select(
          input.kind === "commitment"
            ? "id,conversation_id,owner_user_id,project_id,status"
            : "id,task_visibility,owner_user_id,created_by,status",
        )
        .eq("organization_id", input.organizationId)
        .eq("id", input.taskId);
      if (input.kind !== "commitment") read = read.eq("task_visibility", "business");
      const task = await read.single();
      if (task.error || !task.data)
        throw new Error("This task is unavailable. Refresh before trying again.");
      const membership = await client
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", input.organizationId)
        .eq("user_id", auth.data.user.id)
        .eq("status", "active")
        .single();
      if (membership.error || !membership.data || !BOARD_WRITE_ROLES.includes(membership.data.role))
        throw new Error("Task write access required.");
      const stored = task.data as unknown as {
        owner_user_id?: string;
        created_by?: string;
        conversation_id?: string;
        project_id?: string;
        status?: string;
      };
      if (
        !["owner", "admin"].includes(membership.data.role) &&
        stored.owner_user_id !== auth.data.user.id &&
        (input.kind === "commitment" || stored.created_by !== auth.data.user.id)
      )
        throw new Error("Only the authorized owner or manager can update this task.");
      if (
        input.kind === "commitment" &&
        (stored.project_id || stored.conversation_id !== input.meetingId)
      )
        throw new Error("Use the original meeting and the room that owns this work.");
      if (input.action === "roll_forward") {
        if (stored.status === "kept" || stored.status === "complete")
          throw new Error("This work is already complete. Post an update instead.");
        if (input.laterDate && input.laterMeetingId)
          throw new Error("Choose one later meeting or date.");
        if (!input.laterDate && !input.laterMeetingId)
          throw new Error("Choose a later meeting or date.");
        if (
          input.laterDate &&
          (Number.isNaN(Date.parse(input.laterDate)) ||
            new Date(input.laterDate).toISOString().slice(0, 10) !== input.laterDate ||
            input.laterDate <= new Date().toISOString().slice(0, 10))
        )
          throw new Error("Choose a future date.");
        if (input.laterMeetingId) {
          const meetings = await client
            .from("conversations")
            .select("id,occurred_at")
            .eq("organization_id", input.organizationId)
            .in("id", [input.meetingId, input.laterMeetingId]);
          const origin = meetings.data?.find((m) => m.id === input.meetingId);
          const later = meetings.data?.find((m) => m.id === input.laterMeetingId);
          if (meetings.error || !origin || !later || later.occurred_at <= origin.occurred_at)
            throw new Error("Choose an accessible meeting after the original meeting.");
        }
      }
      const key = `steward-update:${input.operationId}`;
      const payload = {
        note: input.note,
        author_name: input.authorName,
        action: input.action,
        original_meeting_id: input.meetingId,
        original_due: input.originalDue,
        task_kind: input.kind,
        later_meeting_id: input.laterMeetingId,
        later_date: input.laterDate,
        source_event_key: key,
      };
      const result = await client
        .from("activities")
        .insert({
          organization_id: input.organizationId,
          app_key: "steward",
          event_type: "task.updated",
          actor_user_id: auth.data.user.id,
          entity_type: "task",
          entity_id: input.taskId,
          source_event_key: key,
          summary:
            input.action === "roll_forward"
              ? "Rolled forward; original obligation remains open."
              : "Shared a task update.",
          occurred_at: new Date().toISOString(),
          payload,
        })
        .select("id")
        .single();
      if (result.error?.code === "23505") {
        const existing = await client
          .from("activities")
          .select("payload,entity_id,actor_user_id")
          .eq("organization_id", input.organizationId)
          .eq("app_key", "steward")
          .eq("source_event_key", key)
          .single();
        if (
          !existing.error &&
          existing.data?.entity_id === input.taskId &&
          existing.data.actor_user_id === auth.data.user.id &&
          Object.entries(payload).every(([key, value]) => existing.data.payload[key] === value)
        )
          return;
        throw new Error("This operation has already been used. Refresh to inspect its outcome.");
      }
      if (result.error || !result.data)
        throw new Error(
          result.error?.message || "Update was not confirmed. Retry the same update.",
        );
    },
  };
}
export const taskUpdates = stewardUpdates();
