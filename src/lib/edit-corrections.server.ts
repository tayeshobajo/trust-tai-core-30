/**
 * Edit-learning corrections: persistence and read-back.
 *
 * Why the activities table and not `intelligence_cases`: the case ledger is
 * written by the pattern engine against registered pattern ids, and no
 * server write path exists for free-form corrections without a migration.
 * This build avoids new migrations entirely, so a correction is recorded as
 * an activities row (name "relationship.correction") plus a copy on the
 * draft's rationale jsonb. The read side maps rows into the same
 * corrections lane the retrieval bundle already treats as outranking
 * inference (see StoredEditCorrection in scout-retrieval.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EditCorrectionRecord } from "@/domain/edit-correction";
import { correctionLesson } from "@/domain/edit-correction";
import type { StoredEditCorrection } from "@/lib/scout-retrieval";

export const EDIT_CORRECTION_ACTIVITY = "relationship.correction";

/* Loose on purpose: callers hold differently-typed clients (service role,
   RLS browser client). Every query here names its table and columns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
type Row = Record<string, unknown>;

export interface RecordEditCorrectionInput {
  organizationId: string;
  relationshipId: string | null;
  draftId: string;
  record: EditCorrectionRecord;
  actorId?: string | null;
}

/**
 * Persist one correction as an activities row. Best-effort by contract: the
 * caller must never let a capture failure interfere with the human's
 * approve or discard, so this returns false instead of throwing.
 */
export async function recordEditCorrection(
  client: Client,
  input: RecordEditCorrectionInput,
): Promise<boolean> {
  try {
    const { error } = await client.from("activities").insert({
      organization_id: input.organizationId,
      app_key: "comms",
      event_type: EDIT_CORRECTION_ACTIVITY,
      entity_type: "comms_draft",
      entity_id: input.draftId,
      summary: correctionLesson(input.record),
      payload: {
        relationship_id: input.relationshipId,
        draft_id: input.draftId,
        correction: input.record,
      },
      occurred_at: input.record.captured_at,
      ...(input.actorId ? { actor_user_id: input.actorId } : {}),
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Read recent corrections for retrieval composition. Never throws; an
 * unreadable store is an empty list, and the caller's withheld reporting
 * stays honest about the rest of its sources.
 */
export async function readEditCorrections(
  client: Client,
  organizationId: string,
  limit = 20,
): Promise<StoredEditCorrection[]> {
  try {
    const { data, error } = await client
      .from("activities")
      .select("id, organization_id, summary, occurred_at, actor_user_id")
      .eq("organization_id", organizationId)
      .eq("event_type", EDIT_CORRECTION_ACTIVITY)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Row[])
      .filter((row) => typeof row["summary"] === "string" && (row["summary"] as string).length > 0)
      .map((row) => ({
        id: String(row["id"] ?? ""),
        organizationId: String(row["organization_id"] ?? organizationId),
        lesson: String(row["summary"]),
        capturedAt: String(row["occurred_at"] ?? ""),
        capturedBy: typeof row["actor_user_id"] === "string" ? row["actor_user_id"] : null,
      }));
  } catch {
    return [];
  }
}
