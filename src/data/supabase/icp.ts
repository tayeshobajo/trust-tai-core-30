/**
 * Ideal Client Profile — the organization's targeting intelligence.
 *
 * One row per organization in `icp_profiles`. The saved Markdown is the source
 * of truth; the frontend never carries its own copy.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";

import { writeTolerant, type IcpProfileRow, type Row } from "./schema";

export interface IcpProfile {
  id: ID;
  organizationId: ID;
  title: string;
  contentMarkdown: string;
  sourceFilename: string | null;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

function toIcp(row: IcpProfileRow): IcpProfile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title ?? "Ideal Client Profile",
    contentMarkdown: row.content_markdown ?? "",
    sourceFilename: row.source_filename ?? null,
    version: Number(row.version ?? 1),
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
  };
}

/** The current organization ICP, or null when none has been seeded yet. */
export async function getCurrentIcp(organizationId: ID): Promise<IcpProfile | null> {
  const { data, error } = await supabase
    .from("icp_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .order("version", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as IcpProfileRow | undefined;
  return row ? toIcp(row) : null;
}

export interface SaveIcpInput {
  current: IcpProfile;
  contentMarkdown: string;
  title?: string;
  sourceFilename?: string | null;
  userId: ID;
}

/**
 * Update the existing organization ICP row in place: new content, new version,
 * `updated_by` = the signed-in user. `updated_at` is left to the database.
 */
export async function saveIcp(input: SaveIcpInput): Promise<IcpProfile> {
  const payload: Row = {
    content_markdown: input.contentMarkdown,
    title: input.title ?? input.current.title,
    version: input.current.version + 1,
    updated_by: input.userId,
  };
  if (input.sourceFilename !== undefined) payload["source_filename"] = input.sourceFilename;

  const { data, error } = await writeTolerant<Row>(payload, ["content_markdown"], async (body) => {
    const result = await supabase
      .from("icp_profiles")
      .update(body)
      .eq("id", input.current.id)
      .select("*")
      .maybeSingle();
    return { data: (result.data ?? null) as Row | null, error: result.error };
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The ICP could not be saved. You may not have permission to edit it.");
  return toIcp(data as unknown as IcpProfileRow);
}
