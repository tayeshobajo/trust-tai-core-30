/**
 * The trusttai.com publish queue endpoint.
 *
 * Publishing needs a credential the browser must never hold, so the transport
 * lives here. Everything else stays where it belongs: the database work runs
 * as the signed-in person, under RLS, and this route refuses anything that a
 * human has not already approved and queued in Studio.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself with a Trust Tai access token.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  publishProviderStatus,
  publishQueuedItem,
  verifyPublishedItem,
} from "@/lib/content-publish.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/content/publish")({
  server: {
    handlers: {
      /** Is publishing wired at all? The room asks before offering the button. */
      GET: async () => Response.json(publishProviderStatus()),

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to publish." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const itemId = String(body["item_id"] ?? "");
        const action = body["action"] === "verify" ? "verify" : "publish";
        if (!organizationId || !itemId) {
          return Response.json(
            { error: "A workspace and a post are both required." },
            { status: 400 },
          );
        }

        try {
          if (action === "verify") {
            const outcome = await verifyPublishedItem({ token, organizationId, itemId });
            return Response.json(outcome);
          }
          const outcome = await publishQueuedItem({ token, organizationId, itemId });
          return Response.json(outcome);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
      },
    },
  },
});
