/**
 * Curated watchlist persistence.
 *
 * Membership is a marker on the canonical `prospects` row. A company added by
 * hand that Scout has never seen gets a real prospect row (status
 * `discovered`, source `scout_watchlist_manual`) so the rest of Scout can read
 * it normally. No parallel company store, and nothing is researched or scored
 * by being added.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type { WatchlistMarker, WatchlistMethod } from "@/domain/scout-watchlist";
import { watchlistMarkerRow, watchlistSourceKey } from "@/data/scout/watchlist";
import { normalizeWebsiteUrl } from "@/lib/website-url";

import type { ProspectRow } from "./schema";
import { saveProspectMetadataPatch } from "./prospects";

/** Provenance marker for a company a person put on the watchlist by hand. */
export const SCOUT_WATCHLIST_SOURCE = "scout_watchlist_manual";

const SELECT_COLUMNS =
  "id, organization_id, company_name, website_url, status, source, fit_score, observed, inferred, suggested, provenance, metadata, created_by, created_at, updated_at";

export interface WatchlistAddInput {
  organizationId: ID;
  userId: ID;
  userLabel?: string | null;
  name: string;
  websiteUrl?: string | null;
  method: WatchlistMethod;
  note?: string | null;
}

export interface WatchlistAddResult {
  prospectId: ID;
  companyName: string;
  /** False when the company already existed and was only marked. */
  created: boolean;
  /** True when the company was already on the watchlist: a replayed save. */
  alreadyWatched: boolean;
}

async function findExisting(
  organizationId: ID,
  name: string,
  websiteUrl: string | null,
): Promise<ProspectRow | null> {
  if (websiteUrl) {
    const { data, error } = await supabase
      .from("prospects")
      .select(SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("website_url", websiteUrl)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as unknown as ProspectRow;
  }
  const { data, error } = await supabase
    .from("prospects")
    .select(SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .ilike("company_name", name)
    .limit(1);
  if (error) throw new Error(error.message);
  const [row] = (data ?? []) as unknown as ProspectRow[];
  return row ?? null;
}

/**
 * Put one company on the watchlist. Idempotent by company identity: saving the
 * same list twice never creates a second row.
 */
export async function addToWatchlist(input: WatchlistAddInput): Promise<WatchlistAddResult> {
  const at = new Date().toISOString();
  const name = input.name.trim();
  const websiteUrl = input.websiteUrl ? normalizeWebsiteUrl(input.websiteUrl) : null;
  const marker: WatchlistMarker = {
    method: input.method,
    by: input.userId,
    byLabel: input.userLabel ?? null,
    at,
    note: input.note?.trim() || null,
    sourceKey: watchlistSourceKey(input.organizationId, websiteUrl ?? name),
  };

  const existing = await findExisting(input.organizationId, name, websiteUrl);
  if (existing) {
    const already = Boolean(
      existing.metadata &&
      typeof existing.metadata === "object" &&
      (existing.metadata as Record<string, unknown>)["scout_watchlist"],
    );
    if (!already) {
      await saveProspectMetadataPatch(existing.id, {
        scout_watchlist: watchlistMarkerRow(marker),
      });
    }
    return {
      prospectId: existing.id,
      companyName: existing.company_name,
      created: false,
      alreadyWatched: already,
    };
  }

  const { data, error } = await supabase
    .from("prospects")
    .insert({
      organization_id: input.organizationId,
      company_name: name,
      website_url: websiteUrl,
      status: "discovered",
      source: SCOUT_WATCHLIST_SOURCE,
      observed: [],
      inferred: {},
      suggested: {},
      provenance: {
        app_key: "scout",
        source_kind: "watchlist_curated",
        note: "Added to the Scout watchlist by a person here. Nothing was sourced, researched or scored by this action.",
        method: input.method,
        added_by: input.userId,
        observed_at: at,
        source_event_key: marker.sourceKey,
      },
      metadata: { scout_watchlist: watchlistMarkerRow(marker) },
      created_by: input.userId,
    })
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That company could not be saved to the watchlist.");
  const row = data as unknown as ProspectRow;
  return {
    prospectId: row.id,
    companyName: row.company_name,
    created: true,
    alreadyWatched: false,
  };
}

/** Take a company off the watchlist. The company itself is never deleted. */
export async function removeFromWatchlist(id: ID): Promise<void> {
  await saveProspectMetadataPatch(id, { scout_watchlist: null });
}
