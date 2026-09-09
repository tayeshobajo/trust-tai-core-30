/**
 * Scout contact-route search, over the ZenMode lead pool.
 *
 * Replaces `/api/public/linki/lookup`. That endpoint asked Linki to drive a
 * live LinkedIn session; this one reads leads a ZenMode campaign already
 * scraped. No outbound call of any kind happens here — not to LinkedIn, not to
 * ZenMode — so there is no session to get blocked and no secret to hold.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself — valid Supabase access token, active organization membership
 * resolved server-side, and the read performed with the CALLER'S token so RLS
 * and the organization boundary still apply.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";
import { zenModePoolFindPerson } from "@/lib/zenmode-pool-lookup.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function clientFor(token: string): SupabaseClient {
  const key = trustTaiSupabaseKey();
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}`, apikey: key },
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/zenmode/lookup")({
  server: {
    handlers: {
      // Configuration probe. The pool search needs no key and no provider, so
      // it is available wherever the app is — this exists so the UI can render
      // the same shape it did for the old provider-gated lookup.
      GET: async () => json({ configured: true, enabled: true }),

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return json({ error: "Sign in to search contact routes." }, 401);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const fullName = typeof body["full_name"] === "string" ? body["full_name"].trim() : "";
        const companyName =
          typeof body["company_name"] === "string" ? body["company_name"].trim() : undefined;
        const companyDomain =
          typeof body["company_domain"] === "string" ? body["company_domain"].trim() : undefined;
        const roleTitle =
          typeof body["role_title"] === "string" ? body["role_title"].trim() : undefined;
        const personLocation =
          typeof body["location"] === "string" ? body["location"].trim() : undefined;
        const organizationId =
          typeof body["organization_id"] === "string" ? body["organization_id"] : undefined;

        if (fullName.length < 2) {
          return json({ error: "A person's full name is required before we can search." }, 400);
        }

        const supabase = clientFor(token);
        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        const user = userData?.user;
        if (userError || !user) {
          return json(
            { error: "Your session has expired. Sign in again to search contact routes." },
            401,
          );
        }

        const { data: memberships } = await supabase
          .from("organization_memberships")
          .select("organization_id, status")
          .eq("user_id", user.id);
        const active = (memberships ?? []).filter((m) => (m["status"] ?? "active") === "active");
        const membership = organizationId
          ? active.find((m) => m["organization_id"] === organizationId)
          : active[0];
        if (!membership) {
          return json({ error: "Your account is not a member of this Trust Tai workspace." }, 403);
        }

        try {
          const result = await zenModePoolFindPerson(supabase, {
            organizationId: membership["organization_id"] as string,
            fullName,
            ...(companyName ? { companyName } : {}),
            ...(companyDomain ? { companyDomain } : {}),
            ...(roleTitle ? { roleTitle } : {}),
            ...(personLocation ? { location: personLocation } : {}),
          });
          return json({
            candidates: result.candidates,
            no_match_reason: result.noMatchReason,
            pool_size: result.poolSize,
          });
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "The contact route search failed. Nothing was changed.",
            },
            503,
          );
        }
      },
    },
  },
});
