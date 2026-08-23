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

import {
  DraftFailure,
  draftMessage,
  parseRegister,
  type DraftFailureCode,
} from "@/lib/comms-draft.server";
import { runtimeProviderStatus } from "@/lib/intelligence-runtime.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

/** Where each typed draft failure belongs on the wire. */
const DRAFT_FAILURE_STATUS: Record<DraftFailureCode, number> = {
  provider_not_configured: 503,
  access_denied: 403,
  provider_call_failed: 502,
  judgment_unreadable: 502,
  writing_unreadable: 502,
  empty_draft: 502,
};

export const Route = createFileRoute("/api/public/comms/draft")({
  server: {
    handlers: {
      /** Whether drafting is available, and on which provider. Never a key. */
      GET: async () => {
        const status = runtimeProviderStatus();
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
          /* Typed post-grounding failures: the person keeps the calm sentence
             and gets a machine-readable code; the status tells an operator
             which side of the provider boundary broke. */
          if (error instanceof DraftFailure) {
            return Response.json(
              { error: error.message, code: error.code },
              { status: DRAFT_FAILURE_STATUS[error.code] },
            );
          }
          const message =
            error instanceof Error ? error.message : "That draft could not be prepared.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
