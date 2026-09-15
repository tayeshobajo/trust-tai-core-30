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

/**
 * Two people editing the same document must not silently overwrite each
 * other. The update names the version it believes it is replacing; if the row
 * has moved on, nothing is written and the caller is handed the newer row so
 * a person can compare and decide. Their writing is never discarded here.
 */
export class VoiceConflictError extends Error {
  readonly latest: VoiceProfile | null;
  constructor(latest: VoiceProfile | null) {
    super(
      latest
        ? `This document was saved by someone else in the meantime (it is now version ${latest.version}). Your writing is still here; compare it with theirs before saving again.`
        : "This document could not be saved and its current state could not be read back. Your writing is still here.",
    );
    this.name = "VoiceConflictError";
    this.latest = latest;
  }
}

/**
 * Write the Voice DNA. Creates the row the first time, versions it after.
 *
 * A blank save is never quietly turned into the Trust Tai starting document:
 * emptying the page and saving is either a mistake or an explicit reset, and
 * only the caller can say which (`reset: true`).
 */
export async function saveVoiceProfile(input: {
  organizationId: ID;
  current: VoiceProfile | null;
  contentMarkdown: string;
  userId: ID;
  /** Deliberately restore the Trust Tai starting document. */
  reset?: boolean;
}): Promise<VoiceProfile> {
  const typed = input.contentMarkdown.trim();
  if (!typed && !input.reset) {
    throw new Error(
      "There is nothing to save. Write the document, or choose Reset to the starting document if that is what you meant.",
    );
  }
  const content = input.reset && !typed ? DEFAULT_VOICE_DOCUMENT : typed;

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
    .eq("organization_id", input.organizationId)
    // Optimistic concurrency: only the version this edit started from.
    .eq("version", input.current.version)
    .select("*")
    .maybeSingle();
  assertOk(error);
  if (data) return toProfile(data as unknown as VoiceRow);

  // No row matched. Either someone else saved first, or the database refused
  // the write. Read the row back to tell a person which, honestly.
  const latest = await getVoiceProfile(input.organizationId);
  if (latest && latest.version !== input.current.version) throw new VoiceConflictError(latest);
  throw new Error(
    "The Voice DNA could not be saved. Owner and admin members may edit it; the database enforces that, not this screen.",
  );
}

/**
 * The versions of the voice this workspace has actually been reviewed against.
 *
 * There is no separate edit-history table, and inventing one would be a claim
 * the records cannot support. What does exist is honest and immutable: every
 * review run froze the exact rules text it was given, with a SHA-256 checksum.
 * That is what this reads — a bounded window of the most recent runs, and it
 * says so rather than implying a complete history.
 *
 * "Captured" and "evaluated" are different things. A run that failed before
 * the model answered still captured the rules it was built with; only a
 * completed run was actually measured against them.
 */
export interface VoiceSnapshot {
  /** The profile the run was built from, when it was recorded. */
  profileId: string | null;
  /** The profile version the run was held against, when it was recorded. */
  version: number | null;
  checksum: string | null;
  /** True when the exact rules text was kept with the run. */
  textRetained: boolean;
  /** The retained rules text, for a member authorized to read these runs. */
  rulesText: string | null;
  /** Runs whose packet was built from this exact text. */
  capturedRuns: number;
  /** Of those, runs that actually completed an evaluation. */
  completedRuns: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
}

export interface VoiceSnapshotHistory {
  snapshots: VoiceSnapshot[];
  /** How many runs were read. */
  runsRead: number;
  /** True when the window was full, so older runs exist beyond it. */
  bounded: boolean;
  windowSize: number;
}

const SNAPSHOT_WINDOW = 200;

export async function listVoiceSnapshots(organizationId: ID): Promise<VoiceSnapshotHistory> {
  const { data, error } = await supabase
    .from("comms_review_runs")
    .select(
      "voice_profile_id, voice_version, voice_snapshot_checksum, style_context_snapshot, status, started_at",
    )
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(SNAPSHOT_WINDOW);
  assertOk(error);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const byKey = new Map<string, VoiceSnapshot>();

  for (const entry of rows) {
    const profileId =
      typeof entry["voice_profile_id"] === "string" ? (entry["voice_profile_id"] as string) : null;
    const checksum =
      typeof entry["voice_snapshot_checksum"] === "string"
        ? (entry["voice_snapshot_checksum"] as string)
        : null;
    const version =
      typeof entry["voice_version"] === "number" ? (entry["voice_version"] as number) : null;
    if (!checksum && version === null && !profileId) continue;

    const snapshot = entry["style_context_snapshot"];
    const rulesText =
      typeof snapshot === "object" &&
      snapshot !== null &&
      typeof (snapshot as Record<string, unknown>)["rulesText"] === "string"
        ? ((snapshot as Record<string, unknown>)["rulesText"] as string)
        : null;
    const at = typeof entry["started_at"] === "string" ? (entry["started_at"] as string) : null;
    const completed = entry["status"] === "complete";

    // Grouped by the actual profile, version and text. Two workspaces' rules,
    // or two profiles' rules, never merge into one row.
    const key = `${profileId ?? "?"}#${version ?? "?"}#${checksum ?? "?"}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.capturedRuns += 1;
      if (completed) existing.completedRuns += 1;
      if (rulesText && !existing.rulesText) {
        existing.rulesText = rulesText;
        existing.textRetained = true;
      }
      if (at && (!existing.firstUsedAt || at < existing.firstUsedAt)) existing.firstUsedAt = at;
      if (at && (!existing.lastUsedAt || at > existing.lastUsedAt)) existing.lastUsedAt = at;
      continue;
    }
    byKey.set(key, {
      profileId,
      version,
      checksum,
      textRetained: rulesText !== null,
      rulesText,
      capturedRuns: 1,
      completedRuns: completed ? 1 : 0,
      firstUsedAt: at,
      lastUsedAt: at,
    });
  }

  return {
    snapshots: [...byKey.values()].sort((a, b) =>
      (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""),
    ),
    runsRead: rows.length,
    bounded: rows.length >= SNAPSHOT_WINDOW,
    windowSize: SNAPSHOT_WINDOW,
  };
}
