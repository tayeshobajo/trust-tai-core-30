/**
 * Authorisation and run state for the Website provider syncs.
 *
 * Same shape as Intelligence reconciliation: the shared secret lives in a
 * service role only config row in the shared Core database, so the schedule
 * can be turned on from Supabase alone and nothing is copied into a
 * deployment. A missing row means not configured, which refuses rather than
 * opens.
 */

import { constantTimeEquals } from "./intelligence-reconcile-auth.server";

export const WEBSITE_SYNC_CONFIG_ID = "global";

type ConfigClient = { from: (table: string) => any };

export interface WebsiteSyncConfig {
  secret: string;
  siteOrigin: string | null;
  organizationId: string | null;
}

/** Reads the one config row. Any failure reads as "not configured". */
export async function loadWebsiteSyncConfig(
  client: ConfigClient,
): Promise<WebsiteSyncConfig | null> {
  try {
    const { data, error } = await client
      .from("website_sync_config")
      .select("secret, site_origin, organization_id")
      .eq("id", WEBSITE_SYNC_CONFIG_ID)
      .maybeSingle();
    if (error) return null;
    const secret = typeof data?.secret === "string" ? data.secret.trim() : "";
    if (!secret) return null;
    return {
      secret,
      siteOrigin: typeof data?.site_origin === "string" ? data.site_origin.trim() : null,
      organizationId:
        typeof data?.organization_id === "string" ? data.organization_id.trim() : null,
    };
  } catch {
    return null;
  }
}

export type WebsiteSyncAuth =
  | { ok: true; config: WebsiteSyncConfig }
  | { ok: false; status: 503 | 401; error: string };

/** Decides whether a presented header may run a website sync. */
export async function authorizeWebsiteSync(
  client: ConfigClient,
  presented: string | null,
): Promise<WebsiteSyncAuth> {
  const config = await loadWebsiteSyncConfig(client);
  if (!config) {
    return { ok: false, status: 503, error: "Website sync is not configured on this deployment." };
  }
  if (!constantTimeEquals(presented ?? "", config.secret)) {
    return { ok: false, status: 401, error: "Not allowed." };
  }
  return { ok: true, config };
}

/** Records what a run did, so the room can tell fresh from stale from failed. */
export async function recordSyncRun(
  client: ConfigClient,
  input: {
    organizationId: string;
    provider: string;
    configured: boolean;
    rowsWritten: number;
    error?: string | null;
    summary?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await client.from("website_provider_sync").upsert(
      {
        organization_id: input.organizationId,
        provider: input.provider,
        configured: input.configured,
        last_run_at: now,
        ...(input.error ? {} : { last_success_at: now }),
        last_error: input.error ? String(input.error).slice(0, 500) : null,
        rows_written: input.rowsWritten,
        summary: input.summary ?? {},
        updated_at: now,
      },
      { onConflict: "organization_id,provider" },
    );
  } catch {
    /* a run record that cannot be written must not fail the run itself */
  }
}
