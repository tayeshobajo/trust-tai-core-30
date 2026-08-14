/**
 * Gmail sync (raw HTTP).
 *
 * One bounded incremental pass, run by a signed-in member. Every read and
 * write is made with the caller's token, so RLS and the organization boundary
 * still hold. Messages with people Comms does not already track are counted
 * and dropped, never stored.
 */

import { createFileRoute } from "@tanstack/react-router";

import { gmailAvailable, syncGmail } from "@/lib/comms-gmail.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/comms/gmail/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to read the mailbox." }, { status: 401 });
        }
        if (!gmailAvailable()) {
          return Response.json(
            { error: "Gmail is not configured on the server yet." },
            { status: 400 },
          );
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId =
          typeof body["organizationId"] === "string" ? body["organizationId"] : "";
        if (!organizationId) {
          return Response.json({ error: "A workspace is required." }, { status: 400 });
        }

        try {
          const result = await syncGmail({
            token,
            organizationId,
            ...(typeof body["backfillDays"] === "number"
              ? { backfillDays: body["backfillDays"] }
              : {}),
          });
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "That read failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
