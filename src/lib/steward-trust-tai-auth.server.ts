/**
 * Dedicated auth middleware for Steward's canonical backend entrypoints.
 *
 * Identical validation shape to the generated `requireSupabaseAuth`
 * (Bearer token → getClaims → per-request RLS client), but pinned to the
 * ONE Trust Tai backend via `trust-tai-backend.server.ts` helpers instead
 * of the generic SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY env pair. A
 * leftover or mis-pointed generic env can never silently move these
 * entrypoints to another project; the helpers fall back to the pinned
 * project ref. No runtime config probing, no new credentials.
 *
 * The generated middleware file is integration-managed and must not be
 * edited, so this dedicated middleware lives here.
 */

import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "./trust-tai-backend.server";

function isOpaqueKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export const requireTrustTaiAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }
    const token = authHeader.replace("Bearer ", "");
    if (!token || token.split(".").length !== 3) {
      throw new Error("Unauthorized: Invalid token");
    }

    const url = trustTaiSupabaseUrl();
    const key = trustTaiSupabaseKey();
    const supabase = createClient(url, key, {
      global: {
        fetch: (input, init) => {
          const headers = new Headers(
            typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
          );
          if (init?.headers) {
            new Headers(init.headers).forEach((value, name) => headers.set(name, value));
          }
          // Opaque keys are not bearer JWTs; strip the client default.
          if (isOpaqueKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      throw new Error("Unauthorized: Invalid token");
    }

    return next({
      context: { supabase, userId: data.claims.sub, claims: data.claims },
    });
  },
);
