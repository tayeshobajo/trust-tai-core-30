/**
 * Server-only writer for the external Trust Tai OS database.
 *
 * Uses TRUST_TAI_SUPABASE_SERVICE_KEY against the Trust Tai project URL only.
 * It never falls back to another project's service key. Callers must verify
 * the signed-in person and their authority before using it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

export class TrustTaiWriterUnavailable extends Error {}

let cached: SupabaseClient | undefined;

export function trustTaiWriterConfigured(): boolean {
  return Boolean(process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]);
}

export function trustTaiWriter(): SupabaseClient {
  const key = process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"];
  if (!key) {
    throw new TrustTaiWriterUnavailable(
      "AI work can't start here yet because its server access isn't set up.",
    );
  }
  if (cached) return cached;
  const opaque = key.startsWith("sb_secret_");
  cached = createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (req, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        if (opaque && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        return fetch(req, { ...init, headers: h });
      },
    },
  });
  return cached;
}

/** Presence and reachability only. Never returns any part of the key. */
export async function trustTaiWriterHealth(): Promise<{
  configured: boolean;
  reachable: boolean | null;
  runStorage: boolean | null;
}> {
  if (!trustTaiWriterConfigured()) return { configured: false, reachable: null, runStorage: null };
  try {
    const { error } = await trustTaiWriter()
      .from("steward_agent_runs")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (!error) return { configured: true, reachable: true, runStorage: true };
    const missing = /does not exist|schema cache|42P01|PGRST205/i.test(`${error.code} ${error.message}`);
    return { configured: true, reachable: missing, runStorage: missing ? false : null };
  } catch {
    return { configured: true, reachable: false, runStorage: null };
  }
}
