/**
 * Steward weekly goals.
 *
 * A weekly goal is an outcome the Captain proposes and a person confirms, with
 * a set of Steward tasks linked to it. This reads and writes the
 * public.steward_weekly_goals table.
 *
 * The table is optional. When it has not been applied yet the list reads empty
 * and confirming or creating one says plainly that it needs provisioning first.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { WeeklyGoalRecord, WeeklyGoalStatus } from "@/domain/steward-weekly-goal";

import type { Row } from "./schema";

const NOT_PROVISIONED = /does not exist|schema cache|42P01|PGRST205|PGRST20[0-9]/i;

export class WeeklyGoalsNotProvisionedError extends Error {
  constructor() {
    super(
      "Steward's weekly goals table is not in this workspace yet. Apply docs/steward-weekly-goals-schema.sql, then reload.",
    );
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter(Boolean);
}

function toRecord(row: Row): WeeklyGoalRecord {
  const rawTarget = row["target_count"];
  return {
    id: String(row["id"] ?? ""),
    organizationId: String(row["organization_id"] ?? ""),
    ...(str(row["owner_user_id"]) ? { ownerUserId: str(row["owner_user_id"])! } : {}),
    ...(str(row["owner_label"]) ? { ownerLabel: str(row["owner_label"])! } : {}),
    weekStart: String(row["week_start"] ?? ""),
    title: String(row["title"] ?? ""),
    status: (str(row["status"]) ?? "proposed") as WeeklyGoalStatus,
    linkedTaskIds: asTaskIds(row["linked_task_ids"]),
    ...(typeof rawTarget === "number" ? { targetCount: rawTarget } : {}),
    ...(str(row["proposed_by"]) ? { proposedBy: str(row["proposed_by"])! } : {}),
    ...(str(row["confirmed_at"]) ? { confirmedAt: str(row["confirmed_at"])! } : {}),
    ...(str(row["completed_at"]) ? { completedAt: str(row["completed_at"])! } : {}),
    ...(str(row["notes"]) ? { notes: str(row["notes"])! } : {}),
    ...(str(row["created_by"]) ? { createdBy: str(row["created_by"])! } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

/** The typed input for a Captain's weekly goal proposal. */
export interface CreateWeeklyGoalInput {
  organizationId: ID;
  weekStart: string;
  title: string;
  ownerUserId?: ID | null;
  ownerLabel?: string | null;
  linkedTaskIds?: string[];
  targetCount?: number | null;
  proposedBy?: string | null;
  notes?: string | null;
  createdBy?: ID | null;
}

export const weeklyGoals = {
  /** Read every weekly goal for this workspace. Missing table reads empty. */
  async list(organizationId: ID): Promise<WeeklyGoalRecord[]> {
    const { data, error } = await supabase
      .from("steward_weekly_goals")
      .select("*")
      .eq("organization_id", organizationId)
      .order("week_start", { ascending: false })
      .limit(1000);
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) return [];
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => toRecord(row as Row));
  },

  async provisioned(organizationId: ID): Promise<boolean> {
    const { error } = await supabase
      .from("steward_weekly_goals")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1);
    if (!error) return true;
    return !NOT_PROVISIONED.test(`${error.code} ${error.message}`);
  },

  /**
   * The one active (proposed or confirmed) goal for a person in a given week,
   * or null when there is none. Missing table reads null, never crashes.
   */
  async currentFor(
    organizationId: ID,
    ownerUserId: ID | null,
    weekStart: string,
  ): Promise<WeeklyGoalRecord | null> {
    let query = supabase
      .from("steward_weekly_goals")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("week_start", weekStart)
      .in("status", ["proposed", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(1);
    query = ownerUserId ? query.eq("owner_user_id", ownerUserId) : query.is("owner_user_id", null);
    const { data, error } = await query;
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) return null;
      throw new Error(error.message);
    }
    const first = (data ?? [])[0];
    return first ? toRecord(first as Row) : null;
  },

  /** Confirm a proposed goal: status 'confirmed', confirmed_at set to now. */
  async confirm(id: ID): Promise<WeeklyGoalRecord> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("steward_weekly_goals")
      .update({ status: "confirmed", confirmed_at: now, updated_at: now })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) {
        throw new WeeklyGoalsNotProvisionedError();
      }
      throw new Error(error.message);
    }
    return toRecord((data ?? {}) as Row);
  },

  /**
   * Create the Captain's proposal. It lands 'proposed' and proposed_by
   * 'captain' unless overridden, so it is inert until a person confirms it.
   */
  async create(input: CreateWeeklyGoalInput): Promise<WeeklyGoalRecord> {
    const payload: Row = {
      organization_id: input.organizationId,
      week_start: input.weekStart,
      title: input.title,
      status: "proposed",
      proposed_by: input.proposedBy ?? "captain",
    };
    if (input.ownerUserId !== undefined) payload["owner_user_id"] = input.ownerUserId;
    if (input.ownerLabel !== undefined) payload["owner_label"] = input.ownerLabel;
    if (input.linkedTaskIds !== undefined) payload["linked_task_ids"] = input.linkedTaskIds;
    if (input.targetCount !== undefined) payload["target_count"] = input.targetCount;
    if (input.notes !== undefined) payload["notes"] = input.notes;
    if (input.createdBy !== undefined) payload["created_by"] = input.createdBy;

    const { data, error } = await supabase
      .from("steward_weekly_goals")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      if (NOT_PROVISIONED.test(`${error.code} ${error.message}`)) {
        throw new WeeklyGoalsNotProvisionedError();
      }
      throw new Error(error.message);
    }
    return toRecord((data ?? {}) as Row);
  },
};
