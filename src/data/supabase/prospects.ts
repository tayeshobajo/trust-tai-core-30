/**
 * Prospect persistence on the shared `prospects` table.
 *
 * The schema is known exactly, so reads and writes use the real column names
 * with no tolerance layer: a mismatch fails visibly rather than silently
 * dropping data.
 *
 * Sourcing is still PREVIEW/MOCKED — no external service is contacted and no
 * AI or internet research is performed. What is real is the persistence:
 * preview candidates are written as rows tagged `scout_preview_demo`, and
 * Qualify / Pass update those rows through RLS.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID, Prospect, ProspectStatus } from "@/domain/entities";

import { PROSPECT_STATUSES, type ProspectRow, type Row } from "./schema";

const SELECT_COLUMNS =
  "id, organization_id, company_name, website_url, status, source, fit_score, observed, inferred, suggested, provenance, metadata, created_by, created_at, updated_at";

/** Preview/demo provenance marker written on every Scout-sourced prospect. */
export const SCOUT_PREVIEW_SOURCE = "scout_preview_demo";

function toStatus(value: unknown): ProspectStatus {
  const raw = String(value ?? "discovered") as ProspectStatus;
  return (PROSPECT_STATUSES as readonly string[]).includes(raw) ? raw : "discovered";
}

/** Turn a stored `website_url` into the shorter display form the UI uses. */
export function toDisplayDomain(websiteUrl: string | null): string {
  if (!websiteUrl) return "";
  return websiteUrl
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

export function toProspect(row: ProspectRow): Prospect {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.company_name,
    domain: toDisplayDomain(row.website_url),
    websiteUrl: row.website_url ?? "",
    status: toStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export async function listProspects(organizationId: ID): Promise<Prospect[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ProspectRow[]).map(toProspect);
}

export async function getProspect(id: ID): Promise<Prospect | null> {
  const { data, error } = await supabase
    .from("prospects")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toProspect(data as unknown as ProspectRow) : null;
}

export interface PreviewProspectInput {
  organizationId: ID;
  /** Authenticated user, written to `created_by`. */
  userId: ID;
  name: string;
  websiteUrl: string;
  fitScore?: number;
  /** Facts the preview set states about the company. */
  observed?: unknown[];
  /** Scout's read of why it may fit. Inferred, not observed. */
  inferred?: Row;
  /** The next move Scout suggests. A recommendation, not a decision. */
  suggested?: Row;
  icpVersion?: number;
}

/** Insert a preview/demo candidate, clearly provenanced as such. */
export async function insertPreviewProspect(input: PreviewProspectInput): Promise<Prospect> {
  const payload = {
    organization_id: input.organizationId,
    company_name: input.name,
    website_url: input.websiteUrl,
    status: "discovered",
    source: SCOUT_PREVIEW_SOURCE,
    fit_score: input.fitScore ?? null,
    observed: input.observed ?? [],
    inferred: input.inferred ?? {},
    suggested: input.suggested ?? {},
    provenance: {
      app_key: "scout",
      source_kind: "preview_demo",
      note: "Preview demo candidate from a fixed in-memory set. No external service was searched and no AI research was performed.",
      icp_version: input.icpVersion ?? null,
      observed_at: new Date().toISOString(),
    },
    created_by: input.userId,
  };

  const { data, error } = await supabase
    .from("prospects")
    .insert(payload)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Prospect was not returned after insert.");
  return toProspect(data as unknown as ProspectRow);
}

/** Update a prospect's status using the database's exact status vocabulary. */
export async function updateProspectStatus(id: ID, status: ProspectStatus): Promise<Prospect> {
  const { data, error } = await supabase
    .from("prospects")
    .update({ status })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Prospect was not returned after the status change.");
  return toProspect(data as unknown as ProspectRow);
}
