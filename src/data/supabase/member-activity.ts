/**
 * Trust Tai OS, in-app presence.
 *
 * Signing in and working are two different truths. Supabase Auth owns the
 * first; this owns the second: the last time a person opened a room. A person
 * only ever writes their own row (RLS enforces it), and if the table has not
 * been deployed yet every reader and writer stays silent rather than throwing.
 *
 * Schema: docs/people-activity-schema.sql
 */

import { supabase } from "@/integrations/trust-tai/supabase";

import { missingRelation, type Provisioned } from "./settings-service";
import type { Row } from "./schema";

export interface MemberPresence {
  userId: string;
  lastActivityAt: string;
  /** The room they were last seen in. */
  appKey: string;
}

/** Record that this person just opened a room. Never throws. */
export async function recordModuleOpened(input: {
  organizationId: string;
  userId: string;
  appKey: string;
}): Promise<boolean> {
  const { error } = await supabase.from("member_activity").upsert(
    {
      organization_id: input.organizationId,
      user_id: input.userId,
      app_key: input.appKey,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id,app_key" },
  );
  return !error;
}

/** The most recent room opening per person, for People & access. */
export async function readMemberPresence(
  organizationId: string,
): Promise<Provisioned<Map<string, MemberPresence>>> {
  const result = await supabase
.from("member_activity")
.select("user_id, app_key, last_seen_at")
.eq("organization_id", organizationId)
.order("last_seen_at", { ascending: false });

  if (result.error) {
    if (missingRelation(result.error)) return { provisioned: false, value: new Map() };
    throw new Error(result.error.message);
  }

  const latest = new Map<string, MemberPresence>();
  for (const row of (result.data ?? []) as Row[]) {
    const userId = String(row["user_id"]);
    /* Rows arrive newest first, so the first row per person wins. */
    if (latest.has(userId)) continue;
    latest.set(userId, {
      userId,
      lastActivityAt: String(row["last_seen_at"] ?? ""),
      appKey: String(row["app_key"] ?? ""),
    });
  }
  return { provisioned: true, value: latest };
}
