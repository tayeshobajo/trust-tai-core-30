/**
 * Trust Tai OS — the single Supabase entry point.
 *
 * This project talks to the externally managed Trust Tai Supabase project
 * (ref `okydosoacqdnursmmenf`), NOT to a Lovable-provisioned database.
 *
 * Configuration order:
 *  1. `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` when they point at
 *     the Trust Tai project.
 *  2. A documented PUBLIC fallback so the preview keeps working in environments
 *     where those variables cannot be set.
 *
 * Only the publishable (anon) key is ever used here. Never add a service-role
 * key to this file or anywhere else in the browser bundle: every read and write
 * must pass through Supabase RLS as the signed-in user.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Generic typing bridge: as soon as `src/integrations/supabase/types.ts`
 * contains the real generated `Database` export (non-empty `public.Tables`),
 * the client below becomes `SupabaseClient<Database>` and every `.from()` /
 * `.rpc()` call is compile-checked. While the file still holds the empty
 * placeholder schema, the client stays untyped so nothing breaks.
 */
type HasGeneratedSchema = [keyof Database["public"]["Tables"]] extends [never] ? false : true;
export type TrustTaiClient = HasGeneratedSchema extends true
  ? SupabaseClient<Database>
  : SupabaseClient;

/** Trust Tai's managed Supabase project reference. */
export const TRUST_TAI_PROJECT_REF = "okydosoacqdnursmmenf";

/** Public fallback values. Both are safe to ship to the browser. */
const FALLBACK_URL = `https://${TRUST_TAI_PROJECT_REF}.supabase.co`;
const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL";

function readEnv(name: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value && value.length > 0 ? value : undefined;
}

function resolveConfig(): { url: string; key: string; fromEnv: boolean } {
  const url = readEnv("VITE_SUPABASE_URL");
  const key = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  // Only honour the environment when it points at the Trust Tai project, so a
  // leftover Lovable Cloud project can never shadow the real backend.
  if (url && key && url.includes(TRUST_TAI_PROJECT_REF)) {
    return { url, key, fromEnv: true };
  }
  return { url: FALLBACK_URL, key: FALLBACK_PUBLISHABLE_KEY, fromEnv: false };
}

const config = resolveConfig();

export const supabaseConfig = {
  url: config.url,
  projectRef: TRUST_TAI_PROJECT_REF,
  configuredFromEnv: config.fromEnv,
};

/** New-format `sb_publishable_*` keys are opaque strings, not bearer JWTs. */
function trustTaiFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }
    if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

function create(): TrustTaiClient {
  return createClient<Database>(config.url, config.key, {
    global: { fetch: trustTaiFetch(config.key) },
    auth: {
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      storageKey: `tt-auth-${TRUST_TAI_PROJECT_REF}`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: typeof window !== "undefined",
    },
  }) as TrustTaiClient;
}

let instance: TrustTaiClient | undefined;

/** The one Supabase client for the whole app. */
export const supabase = new Proxy({} as TrustTaiClient, {
  get(_target, prop, receiver) {
    if (!instance) instance = create();
    return Reflect.get(instance, prop, receiver);
  },
});
