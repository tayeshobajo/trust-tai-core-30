/**
 * Comms drafting endpoint.
 *
 * A raw HTTP route so the browser can post a relationship and get one checked
 * draft back. This path bypasses site auth, so the handler authenticates every
 * request itself: a caller must present a valid Trust Tai Supabase access token,
 * and every read is made with that token so RLS still applies.
 *
 * Nothing here sends a message.
 */

import { createFileRoute } from "@tanstack/react-router";

import { draftMessage, parseRegister } from "@/lib/comms-draft.server";
import { scoutProviderStatus } from "@/lib/scout-provider.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/comms/draft")({
  server: {
    handlers: {
      /** Whether drafting is available, and on which provider. Never a key. */
      GET: async () => {
        const status = scoutProviderStatus();
        return Response.json({
          configured: status.configured,
          provider: status.provider,
          model: status.model,
        });
      },

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to draft a message." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const relationshipId = typeof body["relationshipId"] === "string" ? body["relationshipId"] : "";
        if (!relationshipId) {
          return Response.json({ error: "A relationship is required." }, { status: 400 });
        }

        try {
          const result = await draftMessage(token, {
            relationshipId,
            register: parseRegister(body["register"]),
            ...(typeof body["purpose"] === "string" && body["purpose"].trim()
              ? { purpose: body["purpose"].trim() }
              : {}),
          });
          return Response.json(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "That draft could not be prepared.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
