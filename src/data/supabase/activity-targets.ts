/**
 * Organization activity targets, the Outcomes settings backend.
 *
 * Configuration only, exactly like `organization_weekly_targets`: a target
 * says what a good cadence looks like, it never holds an actual. One row per
 * organization per stream, upserted in place.
 *
 * Writes go through the authenticated browser client, so RLS applies as the
 * signed-in person and the organization boundary is enforced by the database,
 * not by this file. No service-role key is ever used here.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";

type Row = Record<string, unknown>;

export const ACTIVITY_STREAMS = ["linkedin_connections", "blog_posts", "scout_intros"] as const;
export type ActivityStream = (typeof ACTIVITY_STREAMS)[number];

export const ACTIVITY_CADENCES = ["day", "week", "month"] as const;
export type ActivityCadence = (typeof ACTIVITY_CADENCES)[number];

export interface ActivityTarget {
  stream: ActivityStream;
  targetCount: number;
  cadence: ActivityCadence;
}

export interface ActivityTargetRecord extends ActivityTarget {
  id: ID;
  organizationId: ID;
  updatedBy: ID | null;
  updatedAt: string | null;
}

export interface ActivityTargetsContext {
  organizationId: ID;
  userId: ID;
}

function assertOk(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function isStream(value: unknown): value is ActivityStream {
  return typeof value === "string" && (ACTIVITY_STREAMS as readonly string[]).includes(value);
}

function isCadence(value: unknown): value is ActivityCadence {
  return typeof value === "string" && (ACTIVITY_CADENCES as readonly string[]).includes(value);
}

function toRecord(row: Row): ActivityTargetRecord | null {
  const stream = row["stream"];
  const cadence = row["cadence"];
  const count = row["target_count"];
  if (!isStream(stream) || !isCadence(cadence)) return null;
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    stream,
    targetCount: Math.trunc(count),
    cadence,
    updatedBy: typeof row["updated_by"] === "string" ? row["updated_by"] : null,
    updatedAt: typeof row["updated_at"] === "string" ? row["updated_at"] : null,
  };
}

/**
 * A target that does not make sense is refused before it can be saved.
 * Counts are whole numbers of things, so nothing negative and nothing
 * fractional.
 */
export function validateActivityTarget(target: ActivityTarget): string[] {
  const problems: string[] = [];
  if (!isStream(target.stream)) problems.push("Unknown activity stream.");
  if (!isCadence(target.cadence)) problems.push("Cadence must be day, week, or month.");
  if (
    typeof target.targetCount !== "number" ||
    !Number.isFinite(target.targetCount) ||
    !Number.isInteger(target.targetCount)
  ) {
    problems.push("The target must be a whole number.");
  } else if (target.targetCount < 0) {
    problems.push("The target cannot be negative.");
  }
  return problems;
}

/** Every configured activity target for the organization. Missing rows mean unset. */
export async function listActivityTargets(organizationId: ID): Promise<ActivityTargetRecord[]> {
  const { data, error } = await supabase
    .from("organization_activity_targets")
    .select("*")
    .eq("organization_id", organizationId)
    .order("stream", { ascending: true });
  assertOk(error);
  return ((data as Row[]) ?? [])
    .map(toRecord)
    .filter((record): record is ActivityTargetRecord => record !== null);
}

/** Upsert one stream's target for the organization. Admin write is enforced by RLS. */
export async function saveActivityTarget(
  target: ActivityTarget,
  context: ActivityTargetsContext,
): Promise<ActivityTargetRecord> {
  const problems = validateActivityTarget(target);
  if (problems.length > 0) throw new Error(problems.join(" "));

  const { data, error } = await supabase
    .from("organization_activity_targets")
    .upsert(
      {
        organization_id: context.organizationId,
        stream: target.stream,
        target_count: target.targetCount,
        cadence: target.cadence,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,stream" },
    )
    .select("*")
    .single();
  assertOk(error);
  const record = toRecord((data as Row) ?? {});
  if (!record) throw new Error("Activity target save returned an unreadable row.");
  return record;
}
