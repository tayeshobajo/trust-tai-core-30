/**
 * Scout -> Linki lookup endpoint.
 *
 * The browser never talks to Linki directly and never sees the internal
 * secret. The signed-in Trust Tai user calls this route with their Supabase
 * access token; the server verifies active workspace membership, then performs
 * the Linki lookup server-to-server.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

import { linkiFindPerson, linkiStatus } from "@/lib/linki-provider.server";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

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

export const Route = createFileRoute("/api/public/linki/lookup")({
  server: {
    handlers: {
      GET: async () => json(linkiStatus()),

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return json({ error: "Sign in to search LinkedIn routes." }, 401);

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
        const organizationId =
          typeof body["organization_id"] === "string" ? body["organization_id"] : undefined;

        if (fullName.length < 2) {
          return json({ error: "A person's full name is required before Linki can search." }, 400);
        }

        const supabase = clientFor(token);
        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        const user = userData?.user;
        if (userError || !user) {
          return json(
            { error: "Your session has expired. Sign in again to search LinkedIn routes." },
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
          const candidates = await linkiFindPerson({
            fullName,
            ...(companyName ? { companyName } : {}),
            ...(companyDomain ? { companyDomain } : {}),
            ...(roleTitle ? { roleTitle } : {}),
          });
          return json({ candidates });
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "LinkedIn route search failed. Nothing was changed.",
            },
            503,
          );
        }
      },
    },
  },
});
