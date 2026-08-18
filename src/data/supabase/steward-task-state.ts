/**
 * Steward's own accountability state.
 *
 * The only thing stored here is how a task is framed and ordered for a human,
 * plus a completion record for meeting-only commitments. Delivery truth stays
 * in Projects and agent truth stays in Paperclip.
 *
 * The table is optional. When it has not been applied yet Steward keeps
 * reading, and says plainly that reordering will not persist.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { StewardFocus, StewardTaskStateRecord } from "@/domain/steward-accountability";

import type { Row } from "./schema";

const NOT_PROVISIONED = /does not exist|schema cache|42P01|PGRST205|PGRST20[0-9]/i;

export class TaskStateNotProvisionedError extends Error {
  constructor() {
    super(
      "Steward's accountability table is not in this workspace yet. Apply docs/steward-accountability-schema.sql, then reload.",
    );
  }
}

function toRecord(row: Row): StewardTaskStateRecord {
  const str = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  return {
    taskKey: String(row["task_key"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    ...(str(row["focus"]) ? { focus: str(row["focus"]) as StewardFocus } : {}),
    ...(row["rank"] != null ? { rank: Number(row["rank"]) } : {}),
    ...(str(row["completed_by_label"]) ? { completedBy: str(row["completed_by_label"])! } : {}),
    ...(str(row["completed_at"]) ? { completedAt: str(row["completed_at"])! } : {}),
    ...(str(row["completion_note"]) ? { completionNote: str(row["completion_note"])! } : {}),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

export const stewardTaskState = {
  /** Read every stored framing for this workspace. Missing table reads empty. */
  async list(organizationId: ID): Promise<StewardTaskStateRecord[]> {
    const { data, error } = await supabase
      .from("steward_task_state")
      .select("*")
      .eq("organization_id", organizationId)
      .limit(1000);
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) return [];
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => toRecord(row as Row));
  },

  async provisioned(organizationId: ID): Promise<boolean> {
    const { error } = await supabase
      .from("steward_task_state")
      .select("task_key")
      .eq("organization_id", organizationId)
      .limit(1);
    if (!error) return true;
    return !NOT_PROVISIONED.test(`${error.code} ${error.message}`);
  },

  /** Write one framing. Same task, same row, always. */
  async save(input: {
    organizationId: ID;
    userId: ID;
    taskKey: string;
    focus?: StewardFocus | null;
    rank?: number | null;
    completedBy?: string | null;
    completedAt?: string | null;
    completionNote?: string | null;
  }): Promise<StewardTaskStateRecord> {
    const payload: Row = {
      organization_id: input.organizationId,
      task_key: input.taskKey,
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    };
    if (input.focus !== undefined) payload["focus"] = input.focus;
    if (input.rank !== undefined) payload["rank"] = input.rank;
    if (input.completedBy !== undefined) payload["completed_by_label"] = input.completedBy;
    if (input.completedAt !== undefined) payload["completed_at"] = input.completedAt;
    if (input.completionNote !== undefined) payload["completion_note"] = input.completionNote;

    const { data, error } = await supabase
      .from("steward_task_state")
      .upsert(payload, { onConflict: "organization_id,task_key" })
      .select("*")
      .single();
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) {
        throw new TaskStateNotProvisionedError();
      }
      throw new Error(error.message);
    }
    return toRecord((data ?? {}) as Row);
  },
};
