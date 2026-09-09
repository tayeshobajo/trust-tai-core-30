/**
 * ZenMode → Scout lead import — server only.
 *
 * Pulls ZenMode campaign leads (GET /leads) and lands them on the shared
 * `prospects` board ALONGSIDE existing Scout discovery — it never replaces the
 * AI discovery path. Each imported lead becomes a `source='zenmode'` prospect
 * whose provenance carries ZenMode's `campaign_id` + `lead_id` as TRANSPORT
 * ids (never canonical identity) and whose `suggested` holds a plain-English
 * recommendation.
 *
 * Laws (mirror scout-discover.server.ts + the prospects contract):
 *   - `prospects` real columns only: company_name, website_url, status,
 *     source, observed[], inferred, suggested (NOT NULL), provenance,
 *     metadata. There is NO contact_title column — the lead's title rides in
 *     `inferred`/`metadata`, never as a top-level column.
 *   - Dedupe by the lead's LinkedIn URL (stored in provenance/metadata) AND by
 *     ZenMode lead_id. A lead without a LinkedIn URL is skipped — there is no
 *     stable person-route to anchor, and ZenMode is transport, not identity.
 *   - Nothing here creates a contact. A prospect is a company/lead card on the
 *     board; the human-confirm path still owns canonical people.
 *
 * Feature-gated OFF behind `ZENMODE_SCOUT_IMPORT_ENABLED` (default false).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  zenModeListLeads,
  type ZenModeLead,
} from "@/lib/zenmode-provider.server";

export const ZENMODE_SCOUT_SOURCE = "zenmode" as const;

export interface ZenModeImportInput {
  organizationId: string;
  /** Optional authenticated user id; written to `created_by` when present. */
  userId?: string | undefined;
  status?: string | undefined;
  campaignId?: string | undefined;
  limit?: number | undefined;
}

export interface ZenModeImportEnv {
  ZENMODE_SCOUT_IMPORT_ENABLED?: string | undefined;
  ZENMODE_READ_ENABLED?: string | undefined;
  ZENMODE_API_KEY?: string | undefined;
  ZENMODE_BASE_URL?: string | undefined;
}

export interface ZenModeImportResult {
  status: "imported" | "disabled";
  imported: number;
  duplicates: number;
  /** Leads with no LinkedIn route to anchor provenance on. */
  skipped: number;
  importedLeadIds: string[];
  note?: string | undefined;
}

/** Lowercase, strip a trailing slash and www — the same shape used to compare
 * a stored LinkedIn route against an observed one. */
function normalizeLinkedin(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = url.trim().toLowerCase().replace(/\/+$/, "");
  return clean || null;
}

function recommendationFor(lead: ZenModeLead): string {
  const who = lead.name ?? "This lead";
  const where = lead.companyName ? ` at ${lead.companyName}` : "";
  return `${who}${where} was surfaced by the ZenMode ICP campaign${
    lead.campaignId ? ` (${lead.campaignId})` : ""
  }. Review the LinkedIn route and confirm fit before any outreach.`;
}

/**
 * Import ZenMode leads as `prospects`. Idempotent across runs: an existing
 * prospect carrying the same LinkedIn route or ZenMode lead_id is counted as a
 * duplicate and left untouched (a human-owned board row is never overwritten
 * by a transport pull).
 */
export async function importZenModeLeadsAsProspects(
  client: SupabaseClient,
  input: ZenModeImportInput,
  env: ZenModeImportEnv = process.env,
): Promise<ZenModeImportResult> {
  if (env["ZENMODE_SCOUT_IMPORT_ENABLED"] !== "true") {
    return {
      status: "disabled",
      imported: 0,
      duplicates: 0,
      skipped: 0,
      importedLeadIds: [],
      note: "ZenMode Scout import is disabled (ZENMODE_SCOUT_IMPORT_ENABLED is not 'true').",
    };
  }

  const leads = await zenModeListLeads(
    {
      ...(input.status ? { status: input.status } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    },
    env as Record<string, string | undefined>,
  );

  // Existing board rows for this org, to dedupe against by LinkedIn route and
  // ZenMode lead_id (both carried in provenance/metadata, since `prospects`
  // has no person-route column of its own).
  const { data: existingRows, error: readError } = await client
    .from("prospects")
    .select("id, provenance, metadata")
    .eq("organization_id", input.organizationId);
  if (readError) {
    throw new Error(`ZenMode import could not read the Scout board: ${readError.message}`);
  }

  const seenLinkedin = new Set<string>();
  const seenLeadIds = new Set<string>();
  for (const row of (existingRows ?? []) as Record<string, unknown>[]) {
    for (const bag of [row["provenance"], row["metadata"]]) {
      const zm = readZenModeBag(bag);
      const url = normalizeLinkedin(zm.linkedin_url);
      if (url) seenLinkedin.add(url);
      if (zm.lead_id) seenLeadIds.add(zm.lead_id);
    }
  }

  let imported = 0;
  let duplicates = 0;
  let skipped = 0;
  const importedLeadIds: string[] = [];
  const now = new Date().toISOString();

  for (const lead of leads) {
    const linkedin = normalizeLinkedin(lead.linkedinUrl);
    if (!linkedin) {
      // No stable route to anchor provenance on. Never guess an identity.
      skipped += 1;
      continue;
    }
    if (seenLinkedin.has(linkedin) || seenLeadIds.has(lead.leadId)) {
      duplicates += 1;
      continue;
    }
    seenLinkedin.add(linkedin);
    seenLeadIds.add(lead.leadId);

    const zenmodeBag = {
      transport: "zenmode",
      lead_id: lead.leadId,
      campaign_id: lead.campaignId,
      linkedin_url: lead.linkedinUrl,
      lead_status: lead.status,
      name: lead.name,
      title: lead.title,
      observed_at: now,
    };

    const { error: insertError } = await client.from("prospects").insert({
      organization_id: input.organizationId,
      company_name: lead.companyName ?? lead.name ?? "ZenMode lead",
      website_url: lead.websiteUrl,
      status: "discovered",
      source: ZENMODE_SCOUT_SOURCE,
      observed: [],
      inferred: {
        name: lead.name,
        title: lead.title,
        lead_status: lead.status,
        linkedin_url: lead.linkedinUrl,
      },
      suggested: { recommendation: recommendationFor(lead) },
      provenance: {
        app_key: "scout",
        app: "scout",
        source: ZENMODE_SCOUT_SOURCE,
        transport: "zenmode",
        campaign_id: lead.campaignId,
        lead_id: lead.leadId,
        linkedin_url: lead.linkedinUrl,
        observed_at: now,
        actor: { type: "system", id: "zenmode-scout-import", label: "ZenMode lead import" },
      },
      metadata: { zenmode: zenmodeBag },
      ...(input.userId ? { created_by: input.userId } : {}),
    });
    if (insertError) {
      throw new Error(`ZenMode import could not add a prospect: ${insertError.message}`);
    }
    imported += 1;
    importedLeadIds.push(lead.leadId);
  }

  return {
    status: "imported",
    imported,
    duplicates,
    skipped,
    importedLeadIds,
    ...(imported === 0
      ? { note: "ZenMode returned no new leads to import for this organization." }
      : {}),
  };
}

/** Read the `{ zenmode: {...} }` bag (or a bare bag) off a provenance/metadata
 * value, tolerating either the nested or flat placement. */
function readZenModeBag(bag: unknown): { lead_id?: string; linkedin_url?: string } {
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return {};
  const record = bag as Record<string, unknown>;
  const nested =
    record["zenmode"] && typeof record["zenmode"] === "object"
      ? (record["zenmode"] as Record<string, unknown>)
      : record;
  const leadId = typeof nested["lead_id"] === "string" ? nested["lead_id"] : undefined;
  const linkedinUrl =
    typeof nested["linkedin_url"] === "string" ? nested["linkedin_url"] : undefined;
  return {
    ...(leadId ? { lead_id: leadId } : {}),
    ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
  };
}
