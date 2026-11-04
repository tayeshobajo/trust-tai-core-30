import type { SupabaseClient } from "@supabase/supabase-js";

/** Atomic monotonic updates. A bounded thread batch cannot clear any obligation. */
export async function advanceRelationshipSummary(
  client: SupabaseClient,
  organizationId: string,
  relationshipId: string,
  lastMessageAt?: string,
  responseDueAt?: string,
) {
  if (lastMessageAt && Number.isFinite(Date.parse(lastMessageAt))) {
    const at = new Date(lastMessageAt).toISOString();
    const { error } = await client
      .from("comms_relationships")
      .update({ last_touch_at: at, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", relationshipId)
      .or(`last_touch_at.is.null,last_touch_at.lt.${at}`);
    if (error) throw new Error(error.message);
  }
  // Preserve every existing due date, including a manual one. Clearing
  // needs provenance and a complete per-thread reconciliation, not a sync batch.
  if (responseDueAt && Number.isFinite(Date.parse(responseDueAt))) {
    const due = new Date(responseDueAt).toISOString();
    const { error } = await client
      .from("comms_relationships")
      .update({ response_due_at: due, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", relationshipId)
      .is("response_due_at", null);
    if (error) throw new Error(error.message);
  }
}
