/**
 * Email send (raw HTTP).
 *
 * The queue and Scout outreach used to call a database function that ran with
 * administrative credentials and never checked which workspace the caller
 * belonged to. They call this instead. Everything is decided by the one send
 * authority: the caller is proved, the approval must cover exactly this
 * message, the attempt is recorded before the provider is asked, and a
 * refusal means the provider is never called.
 */

import { createFileRoute } from "@tanstack/react-router";

import { sendDraftViaResend } from "@/lib/comms-resend-send.server";
import { SendRefused } from "@/lib/comms-send-authority.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/comms/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in again to send this." }, { status: 401 });
        }
        let body: { organizationId?: string; draftId?: string };
        try {
          body = (await request.json()) as { organizationId?: string; draftId?: string };
        } catch {
          return Response.json({ error: "That request could not be read." }, { status: 400 });
        }
        if (!body.organizationId || !body.draftId) {
          return Response.json(
            { error: "A workspace and a draft are both required." },
            { status: 400 },
          );
        }
        try {
          const result = await sendDraftViaResend({
            token,
            organizationId: body.organizationId,
            draftId: body.draftId,
          });
          return Response.json(result, { status: 200 });
        } catch (error) {
          if (error instanceof SendRefused) {
            const status =
              error.code === "access_denied"
                ? 403
                : error.code === "server_not_configured"
                  ? 503
                  : 409;
            return Response.json(
              { error: error.message, code: error.code, blockers: error.blockers },
              { status },
            );
          }
          return Response.json(
            { error: "That send could not be completed, and nothing was sent." },
            { status: 500 },
          );
        }
      },
    },
  },
});
