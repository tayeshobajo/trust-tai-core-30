/**
 * Gmail send (raw HTTP).
 *
 * Explicit human sends only: the browser posts a draft id, the server does
 * the claiming, building, and sending. This path bypasses site auth, so the
 * handler authenticates every request itself and every read and write is
 * made with the caller's token — RLS and the organization boundary hold.
 *
 * GET answers what the connection can do (`canSend` is false while the grant
 * is read-only), so the composer can show a calm permission state instead of
 * a dead button. Nothing here ever sends without a person clicking Send.
 */

import { createFileRoute } from "@tanstack/react-router";

import { gmailAvailable } from "@/lib/comms-gmail.server";
import { sendCapability, sendDraftViaGmail } from "@/lib/comms-gmail-send.server";
import type { SendThreadTarget } from "@/domain/comms-send";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function readThreadTarget(raw: unknown): SendThreadTarget | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (value["mode"] === "reply" && typeof value["providerThreadId"] === "string") {
    return { mode: "reply", providerThreadId: value["providerThreadId"] };
  }
  if (value["mode"] === "new") return { mode: "new" };
  return undefined;
}

export const Route = createFileRoute("/api/public/comms/gmail/send")({
  server: {
    handlers: {
      /** What this workspace's Gmail connection may do. Never a credential. */
      GET: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to check sending." }, { status: 401 });
        }
        const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
        if (!organizationId) {
          return Response.json({ error: "A workspace is required." }, { status: 400 });
        }
        if (!gmailAvailable()) {
          return Response.json({ connected: false, canSend: false });
        }
        try {
          return Response.json(await sendCapability({ token, organizationId }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "That check failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },

      /** Send one draft. Idempotent per draft; a retry replays, never doubles. */
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
        if (!organizationId || !draftId) {
          return Response.json({ error: "A workspace and a draft are required." }, { status: 400 });
        }

        try {
          const outcome = await sendDraftViaGmail({
            token,
            organizationId,
            draftId,
            ...(readThreadTarget(body["threadTarget"])
              ? { threadTarget: readThreadTarget(body["threadTarget"])! }
              : {}),
          });
          // A permission checkpoint is its own status so the client can show
          // the reconnect path instead of a generic failure.
          if (outcome.state === "blocked") {
            return Response.json(outcome, { status: 403 });
          }
          return Response.json(outcome);
        } catch (error) {
          const message = error instanceof Error ? error.message : "That send failed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
