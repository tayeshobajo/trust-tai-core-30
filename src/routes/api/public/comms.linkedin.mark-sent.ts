/**
 * Manual LinkedIn send record (raw HTTP).
 *
 *  POST, record that a member already sent one draft from their own
 *  logged-in LinkedIn account. Nothing is sent from here, this endpoint
 *  writes the record: the draft is claimed and settled through the same
 *  idempotent machinery as a Gmail send, one evidence row lands in
 *  `comms_messages` under a deterministic id, and the relationship's stage
 *  moves forward (never back).
 *
 * Security: this path bypasses site auth, so the server lib authenticates
 * every request itself, valid Supabase token, active membership resolved
 * server-side, every write under the CALLER'S token. 401 for a missing or
 * dead session, 403 only for proven non-membership, 503 when the membership
 * read failed.
 */

import { createFileRoute } from "@tanstack/react-router";

import { markDraftSentOnLinkedin } from "@/lib/comms-linkedin-send.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/comms/linkedin/mark-sent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to record this send." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const organizationId =
          typeof body["organizationId"] === "string" ? body["organizationId"] : "";
        const draftId = typeof body["draftId"] === "string" ? body["draftId"] : "";
        if (!organizationId || !draftId) {
          return Response.json({ error: "A workspace and a draft are required." }, { status: 400 });
        }

        try {
          const result = await markDraftSentOnLinkedin({ token, organizationId, draftId });
          if (result.kind === "auth") {
            return Response.json({ error: result.error }, { status: result.status });
          }
          return Response.json(result.outcome);
        } catch (error) {
          const message = error instanceof Error ? error.message : "That record failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
