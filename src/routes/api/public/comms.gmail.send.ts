/**
 * Gmail send (raw HTTP).
 *
 *  GET   — what each connected mailbox may do, one capability per account,
 *          so the composer can offer a From choice only when one is real.
 *  POST  — send one approved draft. Human-triggered only: this is the hand
 *          on the door, and the server enforces everything else — membership,
 *          the send-scope checkpoint per mailbox, the reply-from rule (a
 *          reply leaves from the mailbox that owns the conversation),
 *          idempotent claim, bounded MIME, sentinel timeline row.
 *
 * The permission checkpoint is a calm 403 with a structured `blocked`
 * outcome, not a stack trace: a read-only grant simply cannot send.
 */

import { createFileRoute } from "@tanstack/react-router";

import { sendCapability, sendDraftViaGmail } from "@/lib/comms-gmail-send.server";
import { gmailAvailable } from "@/lib/comms-gmail.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/comms/gmail/send")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to check send access." }, { status: 401 });
        }
        if (!gmailAvailable()) {
          return Response.json(
            { error: "Gmail is not configured on the server yet." },
            { status: 400 },
          );
        }
        const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
        if (!organizationId) {
          return Response.json({ error: "A workspace is required." }, { status: 400 });
        }
        try {
          return Response.json(await sendCapability({ token, organizationId }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "That check failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to send." }, { status: 401 });
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
        const draftId = typeof body["draftId"] === "string" ? body["draftId"] : "";
        const integrationId =
          typeof body["integrationId"] === "string" && body["integrationId"].trim()
            ? body["integrationId"].trim()
            : undefined;
        if (!organizationId || !draftId) {
          return Response.json(
            { error: "A workspace and a draft are required." },
            { status: 400 },
          );
        }

        const rawTarget = body["threadTarget"];
        const threadTarget =
          rawTarget && typeof rawTarget === "object"
            ? (rawTarget as { mode?: unknown; providerThreadId?: unknown }).mode === "reply" &&
              typeof (rawTarget as { providerThreadId?: unknown }).providerThreadId === "string"
              ? {
                  mode: "reply" as const,
                  providerThreadId: (rawTarget as { providerThreadId: string }).providerThreadId,
                }
              : { mode: "new" as const }
            : undefined;

        try {
          const outcome = await sendDraftViaGmail({
            token,
            organizationId,
            draftId,
            ...(threadTarget ? { threadTarget } : {}),
            ...(integrationId ? { integrationId } : {}),
          });
          // The checkpoint is a first-class answer, not an exception.
          return Response.json(outcome, { status: outcome.state === "blocked" ? 403 : 200 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "That send failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
