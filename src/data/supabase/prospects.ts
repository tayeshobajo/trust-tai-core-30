/**
 * Prospect persistence on the shared `prospects` table.
 *
 * The schema is known exactly, so reads and writes use the real column names
 * with no tolerance layer: a mismatch fails visibly rather than silently
 * dropping data.
 *
 * Sourcing is still PREVIEW/MOCKED, no external service is contacted and no
 * AI or internet research is performed. What is real is the persistence:
 * preview candidates are written as rows tagged `scout_preview_demo`, and
 * Qualify / Pass update those rows through RLS.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID, Prospect, ProspectStatus } from "@/domain/entities";
import { normalizeWebsiteUrl } from "@/lib/website-url";

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

/** Provenance marker written on every live public-website research prospect. */
export const SCOUT_LIVE_SOURCE = "scout_live_website";

/** Every stored row for an organization, newest first. */
export async function listProspectRows(organizationId: ID): Promise<ProspectRow[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProspectRow[];
}

/** Find an existing row for this organization by normalized website address. */
export async function findProspectRowByWebsite(
  organizationId: ID,
  normalizedUrl: string,
): Promise<ProspectRow | null> {
  const rows = await listProspectRows(organizationId);
  const host = toDisplayDomain(normalizedUrl).toLowerCase();
  return rows.find((row) => toDisplayDomain(row.website_url).toLowerCase() === host) ?? null;
}

export interface ResearchProspectInput {
  organizationId: ID;
  userId: ID;
  companyName: string;
  websiteUrl: string;
  observed: unknown;
  inferred: unknown;
  suggested: unknown;
  provenance: Row;
  /** 0–100 deterministic ICP fit score. */
  fitScore?: number | null;
  /** Merged into the row's existing `metadata` (e.g. `{ scout_fit }`). */
  metadata?: Row;
  existing?: ProspectRow | null;
}

/**
 * Shallow-merge new metadata over what is already stored so unrelated keys 
 * `scout_fit`, `scout_fit_override`, `identity` · are never dropped. Only the
 * keys explicitly supplied are replaced.
 */
export function mergeProspectMetadata(existing: unknown, incoming?: Row): Row {
  const base = (existing && typeof existing === "object" ? existing : {}) as Row;
  return { ...base, ...(incoming ?? {}) };
}

/**
 * Save live website research. An existing prospect for the same website has its
 * research fields refreshed in place rather than being duplicated.
 */
export async function saveResearchProspect(input: ResearchProspectInput): Promise<ProspectRow> {
  const research = {
    company_name: input.companyName,
    website_url: input.websiteUrl,
    source: SCOUT_LIVE_SOURCE,
    observed: input.observed ?? [],
    inferred: input.inferred ?? {},
    suggested: input.suggested ?? {},
    provenance: input.provenance,
    ...(input.fitScore === undefined ? {} : { fit_score: input.fitScore }),
    ...(input.metadata
      ? { metadata: mergeProspectMetadata(input.existing?.metadata, input.metadata) }
      : {}),
  };

  if (input.existing) {
    const { data, error } = await supabase
      .from("prospects")
      .update(research)
      .eq("id", input.existing.id)
      .select(SELECT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("The researched prospect could not be updated in your workspace.");
    return data as unknown as ProspectRow;
  }

  const { data, error } = await supabase
    .from("prospects")
    .insert({
      ...research,
      organization_id: input.organizationId,
      status: "discovered",
      created_by: input.userId,
    })
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The researched prospect could not be saved to your workspace.");
  return data as unknown as ProspectRow;
}

/** Store the Comms handoff brief on the prospect, preserving provenance. */
export async function saveHandoffRecord(id: ID, record: Row): Promise<ProspectRow> {
  const { data: current, error: readError } = await supabase
    .from("prospects")
    .select("metadata")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const metadata = mergeProspectMetadata(current?.metadata, { comms_handoff: record });
  const { data, error } = await supabase
    .from("prospects")
    .update({ metadata, status: "ready_for_comms" })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The handoff could not be saved to this prospect.");
  return data as unknown as ProspectRow;
}

export { normalizeWebsiteUrl };

/** Manually set the ICP fit light for a prospect. `null` clears the override. */
export async function setProspectFitOverride(
  id: ID,
  light: "green" | "yellow" | "red" | "neutral" | null,
  userId: ID,
): Promise<ProspectRow> {
  const { data: current, error: readError } = await supabase
    .from("prospects")
    .select("metadata")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const metadata: Row = { ...((current?.metadata ?? {}) as Row) };
  if (light) {
    metadata["scout_fit_override"] = { light, by: userId, at: new Date().toISOString() };
  } else {
    delete metadata["scout_fit_override"];
  }

  const { data, error } = await supabase
    .from("prospects")
    .update({ metadata })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The fit override could not be saved.");
  return data as unknown as ProspectRow;
}
