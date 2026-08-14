/**
 * Mailbox import candidates (raw HTTP).
 *
 * Reads recent message metadata for the signed-in member and returns the
 * people they actually correspond with, so one of them can be turned into a
 * Comms relationship. Nothing is stored by this route.
 */

import { createFileRoute } from "@tanstack/react-router";

import { gmailAvailable, listMailboxCandidates } from "@/lib/comms-gmail.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/comms/gmail/candidates")({
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
          const result = await listMailboxCandidates({ token, organizationId });
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "That read failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
