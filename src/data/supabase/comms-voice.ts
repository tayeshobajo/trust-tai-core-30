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
