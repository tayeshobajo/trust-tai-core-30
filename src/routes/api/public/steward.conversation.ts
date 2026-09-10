/**
 * Steward conversation ingestion endpoint.
 *
 * GET, is a recording source connected, and which recent calls can be read.
 * POST, read one conversation and return it normalized, with Steward's
 *        deterministic proposals attached.
 *
 * Nothing is written here. Reading is not confirming: only a person, in the
 * room, can turn a proposal into workspace truth.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request against a Trust Tai access token and an active organization
 * membership before touching a transcript.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { extractProposals } from "@/data/steward/extract";
import { parseConversationLink } from "@/lib/conversation-source";
import {
  fathomStatus,
  fetchFathomConversation,
  listFathomConversations,
  SourceNotFoundError,
  SourceUnavailableError,
} from "@/lib/steward-fathom.server";
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

export const Route = createFileRoute("/api/public/steward/conversation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = bearer(request);
        if (!token) return Response.json({ error: "Sign in to use Steward." }, { status: 401 });
        const organizationId = new URL(request.url).searchParams.get("organization_id") ?? "";
        if (!(await requireMembership(token, organizationId))) {
          return Response.json(
            { error: "You are not a member of this workspace." },
            { status: 403 },
          );
        }

        const status = fathomStatus();
        if (!status.configured) return Response.json({ status, recent: [] });

        try {
          const recent = await listFathomConversations(8);
          return Response.json({
            status,
            recent: recent.map((conversation) => ({
              title: conversation.title,
              occurred_at: conversation.occurredAt,
              url: conversation.sourceRef.url,
              external_id: conversation.sourceRef.externalId ?? null,
              participants: conversation.participants.map((p) => p.name),
              has_transcript: conversation.segments.length > 0,
            })),
          });
        } catch (error) {
          return Response.json({
            status: {
              ...status,
              configured: false,
              because: error instanceof Error ? error.message : "Fathom could not be reached.",
            },
            recent: [],
          });
        }
      },

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
        const link = String(body["source_url"] ?? "").trim();
        if (!(await requireMembership(token, organizationId))) {
          return Response.json(
            { error: "You are not a member of this workspace." },
            { status: 403 },
          );
        }
        if (!link) {
          return Response.json({ error: "Paste a call link to read." }, { status: 400 });
        }

        const ref = parseConversationLink(link);
        if (!ref) {
          return Response.json(
            {
              error:
                "Steward does not recognise that link. Today it can read Fathom calls; other sources are not connected yet.",
            },
            { status: 400 },
          );
        }

        try {
          const conversation = await fetchFathomConversation(ref);
          if (conversation.segments.length === 0) {
            return Response.json(
              {
                error:
                  "That call has no transcript in Fathom yet. Steward will not guess at what was said.",
              },
              { status: 409 },
            );
          }
          return Response.json({
            conversation,
            proposals: extractProposals(conversation),
          });
        } catch (error) {
          if (error instanceof SourceNotFoundError) {
            return Response.json({ error: error.message }, { status: 404 });
          }
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
