/**
 * Prospect persistence on the shared `prospects` table.
 *
 * Sourcing is still PREVIEW/MOCKED — no external service is contacted. What is
 * real is the persistence: preview candidates are written as rows tagged as
 * preview/demo, and Qualify / Pass update those rows through RLS.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID, Prospect, ProspectStatus } from "@/domain/entities";

import { writeTolerant, type ProspectRow, type Row } from "./schema";

const REQUIRED = ["organization_id", "name", "status"];

/**
 * The database may model the post-qualification state as `ready_for_comms` or
 * simply `qualified`. We try the richer value first and fall back cleanly.
 */
const STATUS_WRITE_ORDER: Record<ProspectStatus, string[]> = {
  new: ["new"],
  qualified: ["qualified"],
  ready_for_comms: ["ready_for_comms", "qualified"],
  passed: ["passed"],
};

function toStatus(value: unknown): ProspectStatus {
  const raw = String(value ?? "new");
  if (raw === "ready_for_comms") return "ready_for_comms";
  if (raw === "qualified") return "qualified";
  if (raw === "passed" || raw === "rejected") return "passed";
  return "new";
}

export function toProspect(row: ProspectRow | Row): Prospect {
  const r = row as ProspectRow;
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    domain: r.domain ?? "",
    status: toStatus(r.status),
    ...(r.steward_user_id ? { stewardUserId: r.steward_user_id } : {}),
    createdAt: r.created_at ?? new Date().toISOString(),
    updatedAt: r.updated_at ?? r.created_at ?? new Date().toISOString(),
  };
}

export async function listProspects(organizationId: ID): Promise<Prospect[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProspectRow[]).map(toProspect);
}

export async function getProspect(id: ID): Promise<Prospect | null> {
  const { data, error } = await supabase.from("prospects").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toProspect(data as unknown as ProspectRow) : null;
}

export interface PreviewProspectInput {
  organizationId: ID;
  userId: ID;
  name: string;
  domain: string;
  icpVersion?: number;
}

/** Insert a preview/demo candidate, clearly provenanced as such. */
export async function insertPreviewProspect(input: PreviewProspectInput): Promise<Prospect> {
  const payload: Row = {
    organization_id: input.organizationId,
    name: input.name,
    domain: input.domain,
    status: "new",
    source: "scout_preview_demo",
    provenance: {
      app_key: "scout",
      source_kind: "preview_demo",
      note: "Preview demo candidate. No external source was searched.",
      created_by: input.userId,
      icp_version: input.icpVersion ?? null,
      observed_at: new Date().toISOString(),
    },
  };

  const { data, error } = await writeTolerant<Row>(payload, REQUIRED, async (body) => {
    const result = await supabase.from("prospects").insert(body).select("*").maybeSingle();
    return { data: (result.data ?? null) as Row | null, error: result.error };
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Prospect was not returned after insert.");
  return toProspect(data as unknown as ProspectRow);
}

/** Update a prospect's status, tolerating either status vocabulary. */
export async function updateProspectStatus(
  id: ID,
  status: ProspectStatus,
  stewardUserId?: ID,
): Promise<Prospect> {
  const attempts = STATUS_WRITE_ORDER[status];
  let lastMessage = "Status could not be saved.";

  for (const value of attempts) {
    const payload: Row = { status: value, steward_user_id: stewardUserId ?? null };
    const { data, error } = await writeTolerant<Row>(payload, ["status"], async (body) => {
      const result = await supabase
        .from("prospects")
        .update(body)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      return { data: (result.data ?? null) as Row | null, error: result.error };
    });
    if (!error && data) return toProspect(data as unknown as ProspectRow);
    if (error) lastMessage = error.message;
  }
  throw new Error(lastMessage);
}
