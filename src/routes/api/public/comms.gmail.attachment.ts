/**
 * Incoming attachment download (raw HTTP).
 *
 * Gmail stays the source of truth for Gmail-native files: bytes are fetched
 * from Gmail on demand and proxied straight back, never copied into Trust
 * Tai storage. The handler authenticates the caller, then proves the exact
 * attachment id belongs to a message row in the caller's own organization
 * before any byte leaves Google.
 *
 * The same path serves inline MIME images: when the stored message metadata
 * marks the resource `inline` (a Content-ID image), the response is served
 * with an inline disposition so the timeline can render it in place. The
 * caller can ask, but only the stored row may declare a resource inline, * and no token or raw Gmail URL ever reaches the browser.
 */

import { createFileRoute } from "@tanstack/react-router";

import { gmailAvailable } from "@/lib/comms-gmail.server";
import { contentDisposition, downloadMailboxAttachment } from "@/lib/comms-gmail-send.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null: null;
}

export const Route = createFileRoute("/api/public/comms/gmail/attachment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to open this file." }, { status: 401 });
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
          typeof body["organizationId"] === "string" ? body["organizationId"]: "";
        const messageId = typeof body["messageId"] === "string" ? body["messageId"]: "";
        const attachmentId =
          typeof body["attachmentId"] === "string" ? body["attachmentId"]: "";
        if (!organizationId || !messageId || !attachmentId) {
          return Response.json(
            { error: "A workspace, a message, and a file are required." },
            { status: 400 },
          );
        }

        try {
          const file = await downloadMailboxAttachment({
            token,
            organizationId,
            messageId,
            attachmentId,
          });
          return new Response(new Blob([file.bytes as BlobPart]), {
            headers: {
              "Content-Type": file.mimeType,
              "Content-Disposition": file.inline
                ? "inline"
: contentDisposition(file.filename),
              // Inline images are re-requested as the person scrolls; files
              // are never cached. Either way, nothing leaves this browser.
              "Cache-Control": file.inline ? "private, max-age=3600": "private, no-store",
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message: "That file could not be opened.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
