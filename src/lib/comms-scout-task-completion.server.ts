import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export interface ScoutTaskCompletion {
  recorded: boolean;
  taskId: string | null;
  note: string;
}

/**
 * Reconciles one provider-confirmed delivery to one canonically linked Scout
 * task. It intentionally cannot send and never guesses from names or titles.
 */
export async function completeScoutTaskAfterSentDelivery(input: {
  client: SupabaseClient;
  organizationId: string;
  deliveryId: string;
}): Promise<ScoutTaskCompletion> {
  const delivery = await input.client
    .from("comms_review_deliveries")
    .select("id, draft_id, status, provider_message_id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.deliveryId)
    .eq("status", "sent")
    .maybeSingle();
  const deliveryRow = (delivery.data ?? null) as Row | null;
  if (delivery.error || !deliveryRow || !deliveryRow["provider_message_id"]) {
    return { recorded: false, taskId: null, note: "No recorded provider-confirmed send was found." };
  }
  const draft = await input.client
    .from("comms_drafts")
    .select("relationship_id")
    .eq("organization_id", input.organizationId)
    .eq("id", String(deliveryRow["draft_id"]))
    .maybeSingle();
  const relationshipId = String((draft.data as Row | null)?.["relationship_id"] ?? "");
  if (draft.error || !relationshipId) {
    return { recorded: false, taskId: null, note: "The sent draft has no readable relationship." };
  }
  const relationship = await input.client
    .from("comms_relationships")
    .select("prospect_id")
    .eq("organization_id", input.organizationId)
    .eq("id", relationshipId)
    .maybeSingle();
  const prospectId = String((relationship.data as Row | null)?.["prospect_id"] ?? "");
  if (relationship.error || !prospectId) {
    return { recorded: false, taskId: null, note: "This message is not linked to a Scout prospect." };
  }
  const correlationId = `scout:prospect:${prospectId}:first-message`;
  const completedAt = new Date().toISOString();
  const update = await input.client
    .from("steward_tasks")
    .update({ status: "complete", updated_at: completedAt })
    .eq("organization_id", input.organizationId)
    .eq("correlation_id", correlationId)
    .neq("status", "complete")
    .select("id");
  if (update.error) {
    return { recorded: false, taskId: null, note: "The send is recorded, but its Scout task needs reconciliation." };
  }
  const rows = (update.data ?? []) as Row[];
  if (rows.length === 0) {
    const existing = await input.client
      .from("steward_tasks")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("correlation_id", correlationId)
      .maybeSingle();
    const row = (existing.data ?? null) as Row | null;
    return row?.["status"] === "complete"
      ? { recorded: true, taskId: String(row["id"]), note: "The linked Scout task was already complete." }
      : { recorded: false, taskId: null, note: "No exact linked Scout task was found." };
  }
  if (rows.length !== 1) {
    return { recorded: false, taskId: null, note: "More than one linked Scout task matched; none was inferred." };
  }
  const taskId = String(rows[0]?.["id"] ?? "");
  await input.client.from("activities").insert({
    organization_id: input.organizationId,
    app_key: "steward",
    event_type: "task.completed",
    actor_user_id: null,
    entity_type: "task",
    entity_id: taskId,
    source_event_key: `comms:delivery:${input.deliveryId}:scout-task-complete`,
    summary: "Scout outreach completed after Comms recorded a sent message.",
    occurred_at: completedAt,
    payload: {
      actor_kind: "system",
      delivery_id: input.deliveryId,
      prospect_id: prospectId,
      completion_basis: "provider_confirmed_sent",
    },
  });
  return { recorded: true, taskId, note: "The linked Scout task is complete." };
}