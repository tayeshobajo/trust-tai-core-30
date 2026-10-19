import { supabase } from "@/integrations/trust-tai/supabase";
import { transcriptDigest, MEETING_PROCESS_VERSION } from "@/data/steward/meeting-process";
import type { StoredConversation } from "./steward-service";
import type { InterpretationResult } from "@/data/steward/ingest";

/** Reuse exact-transcript readings; changed sources cannot inherit an old completed run. */
export async function readMeetingProcesses(org: string, conversations: StoredConversation[]) {
  const states = new Map<string, { result: InterpretationResult | null; message: string }>();
  for (let index = 0; index < conversations.length; index += 60) {
    const batch = conversations.slice(index, index + 60);
    const keys = await Promise.all(
      batch.map(
        async (c) =>
          `meeting-reasoning:${c.id}:${MEETING_PROCESS_VERSION}:${await transcriptDigest(c.conversation)}`,
      ),
    );
    const { data, error } = await supabase
      .from("activities")
      .select("entity_id,source_event_key,payload")
      .eq("organization_id", org)
      .eq("app_key", "steward")
      .eq("event_type", "meeting.reasoned")
      .in("source_event_key", keys)
      .limit(61);
    if (error || (data?.length ?? 0) > 60)
      throw new Error("Meeting reasoning coverage could not be read.");
    batch.forEach((c, i) => {
      const found = data?.find((row) => row.entity_id === c.id && row.source_event_key === keys[i]);
      const result = found?.payload?.result as InterpretationResult | undefined;
      states.set(c.id, {
        result: result ?? null,
        message: result
          ? `All ${result.run.coverage?.segmentsRead ?? 0} stored turns reasoned · review deliverables`
          : c.conversation.segments.length
            ? "Transcript saved · deliverables need full-meeting review"
            : "Transcript missing or not ready · deliverables unknown",
      });
    });
  }
  return states;
}
