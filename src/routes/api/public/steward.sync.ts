/**
 * Steward recent-meetings sync.
 *
 * POST: list the connected source's recent calls, normalized, so the signed-in
 * member's own browser can store the ones the workspace does not have yet.
 *
 * Nothing is written here. Storing happens through the existing member-side
 * upsert pipeline, under RLS, and only a person confirming turns anything
 * heard into workspace truth.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request against a Trust Tai access token and an active organization
 * membership before touching the source.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { fathomStatus, listFathomPage, SourceUnavailableError } from "@/lib/steward-fathom.server";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function clientFor(token: string): SupabaseClient {
  const key = trustTaiSupabaseKey();
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
  });
}

/** A valid token is never enough on its own. Membership decides. */
async function requireMembership(token: string, organizationId: string): Promise<boolean> {
  if (!organizationId) return false;
  const supabase = clientFor(token);
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return false;
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("organization_id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userData.user.id)
    .limit(1);
  if (error) return false;
  return (data ?? []).some((row) => (row["status"] ?? "active") === "active");
}

export const Route = createFileRoute("/api/public/steward/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return Response.json({ error: "Sign in to use Steward." }, { status: 401 });

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const organizationId = String(body["organization_id"] ?? "");
        if (!(await requireMembership(token, organizationId))) {
          return Response.json(
            { error: "You are not a member of this workspace." },
            { status: 403 },
          );
        }

        const status = fathomStatus();
        if (!status.configured) {
          /* A disconnected source is an explicit unavailable state, never a
             successful empty answer the client could mistake for "no calls". */
          return Response.json(
            { error: "The Fathom source is not connected to this workspace." },
            { status: 503 },
          );
        }

        try {
          /* Bounded: two pages, twelve calls. `hasMore` says when older calls
             were left behind rather than implying the list is complete. */
          const result = await listFathomPage(12, 2);
          return Response.json({
            status,
            conversations: result.conversations,
            hasMore: result.hasMore,
          });
        } catch (error) {
          if (error instanceof SourceUnavailableError) {
            return Response.json({ error: error.message }, { status: 503 });
          }
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
