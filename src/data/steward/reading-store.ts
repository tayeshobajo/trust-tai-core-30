import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterpretationResult } from "./ingest";
export async function loadMeetingReading(
  client: SupabaseClient,
  org: string,
  meeting: string,
  key: string,
): Promise<InterpretationResult | null> {
  const prior = await client
    .from("activities")
    .select("payload")
    .eq("organization_id", org)
    .eq("app_key", "steward")
    .eq("entity_id", meeting)
    .eq("source_event_key", key)
    .maybeSingle();
  if (prior.error)
    throw new Error(
      "Saved meeting reasoning could not be read. Retry before starting another run.",
    );
  return prior.data?.payload?.result ?? null;
}
export async function saveMeetingReading(
  client: SupabaseClient,
  input: {
    org: string;
    meeting: string;
    actor: string;
    key: string;
    digest: string;
    version: string;
    result: InterpretationResult;
  },
): Promise<InterpretationResult> {
  const source = await client
    .from("conversations")
    .select("id")
    .eq("organization_id", input.org)
    .eq("id", input.meeting)
    .maybeSingle();
  if (source.error || !source.data)
    throw new Error("Meeting access changed; the reading was not saved.");
  const saved = await client.from("activities").insert({
    organization_id: input.org,
    app_key: "steward",
    entity_type: "conversation",
    entity_id: input.meeting,
    actor_user_id: input.actor,
    event_type: "meeting.reasoned",
    source_event_key: input.key,
    occurred_at: new Date().toISOString(),
    summary: "Full stored transcript reasoned; deliverables await review.",
    payload: { digest: input.digest, version: input.version, result: input.result },
  });
  if (saved.error?.code === "23505") {
    const winner = await loadMeetingReading(client, input.org, input.meeting, input.key);
    if (winner) return winner;
  }
  if (saved.error)
    throw new Error(
      "Reasoning finished but could not be saved. No tasks were confirmed. Retry to recover the review.",
    );
  return input.result;
}
