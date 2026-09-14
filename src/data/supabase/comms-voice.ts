/**
 * Voice DNA persistence.
 *
 * One row per organization. The saved Markdown is the source of truth for
 * drafting; the frontend never carries its own copy. Owner/admin members edit,
 * active members read, exactly like the ICP.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import { DEFAULT_VOICE_DOCUMENT } from "@/domain/voice";

import { assertOk, type Row } from "./comms-schema";

export interface VoiceProfile {
  id: ID;
  organizationId: ID;
  title: string;
  contentMarkdown: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface VoiceRow {
  id: string;
  organization_id: string;
  title: string | null;
  content_markdown: string | null;
  version: number | null;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string | null;
}

function toProfile(row: VoiceRow): VoiceProfile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title ?? "Voice DNA",
    contentMarkdown: row.content_markdown ?? "",
    version: Number(row.version ?? 1),
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
  };
}

/** The organization's Voice DNA, or null when none has been written yet. */
export async function getVoiceProfile(organizationId: ID): Promise<VoiceProfile | null> {
  const { data, error } = await supabase
    .from("comms_voice_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  assertOk(error);
  return data ? toProfile(data as unknown as VoiceRow) : null;
}

/** Write the Voice DNA. Creates the row the first time, versions it after. */
export async function saveVoiceProfile(input: {
  organizationId: ID;
  current: VoiceProfile | null;
  contentMarkdown: string;
  userId: ID;
}): Promise<VoiceProfile> {
  const content = input.contentMarkdown.trim() || DEFAULT_VOICE_DOCUMENT;

  if (!input.current) {
    const payload: Row = {
      organization_id: input.organizationId,
      title: "Voice DNA",
      content_markdown: content,
      version: 1,
      updated_by: input.userId,
    };
    const { data, error } = await supabase
      .from("comms_voice_profiles")
      .insert(payload)
      .select("*")
      .single();
    assertOk(error);
    if (!data) throw new Error("The Voice DNA could not be saved. You may not have permission.");
    return toProfile(data as unknown as VoiceRow);
  }

  const { data, error } = await supabase
    .from("comms_voice_profiles")
    .update({
      content_markdown: content,
      version: input.current.version + 1,
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.current.id)
    .select("*")
    .maybeSingle();
  assertOk(error);
  if (!data) throw new Error("The Voice DNA could not be saved. You may not have permission.");
  return toProfile(data as unknown as VoiceRow);
}

/**
 * The versions of the voice this workspace has actually been reviewed against.
 *
 * There is no separate history table, and inventing one would be a claim the
 * records cannot support. What does exist is honest and immutable: every
 * review run froze the exact rules text it measured against, with a SHA-256
 * checksum. That is what this reads. A version nobody has reviewed under has
 * no snapshot, and says so instead of appearing as one.
 */
export interface VoiceSnapshot {
  /** The profile version the run was held against, when it was recorded. */
  version: number | null;
  checksum: string | null;
  /** True when the exact rules text was kept with the run. */
  textRetained: boolean;
  /** Runs measured against this exact text. */
  runCount: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
}

export async function listVoiceSnapshots(organizationId: ID): Promise<VoiceSnapshot[]> {
  const { data, error } = await supabase
    .from("comms_review_runs")
    .select("voice_version, voice_snapshot_checksum, style_context_snapshot, started_at")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(200);
  assertOk(error);

  const byKey = new Map<string, VoiceSnapshot>();
  for (const entry of (data ?? []) as unknown as Record<string, unknown>[]) {
    const checksum =
      typeof entry["voice_snapshot_checksum"] === "string"
        ? (entry["voice_snapshot_checksum"] as string)
        : null;
    const version =
      typeof entry["voice_version"] === "number" ? (entry["voice_version"] as number) : null;
    if (!checksum && version === null) continue;
    const snapshot = entry["style_context_snapshot"];
    const textRetained =
      typeof snapshot === "object" &&
      snapshot !== null &&
      typeof (snapshot as Record<string, unknown>)["rulesText"] === "string";
    const at = typeof entry["started_at"] === "string" ? (entry["started_at"] as string) : null;

    const key = `${version ?? "?"}#${checksum ?? "?"}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.runCount += 1;
      existing.textRetained = existing.textRetained || textRetained;
      if (at && (!existing.firstUsedAt || at < existing.firstUsedAt)) existing.firstUsedAt = at;
      if (at && (!existing.lastUsedAt || at > existing.lastUsedAt)) existing.lastUsedAt = at;
      continue;
    }
    byKey.set(key, {
      version,
      checksum,
      textRetained,
      runCount: 1,
      firstUsedAt: at,
      lastUsedAt: at,
    });
  }

  return [...byKey.values()].sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
}
