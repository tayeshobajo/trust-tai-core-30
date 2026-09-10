/**
 * POST /api/public/clients/logo
 *
 * Upload one company image and record it on the canonical client row.
 *
 * Security: the caller sends their own Supabase access token. Active
 * membership of the named organization is verified, the client row is read
 * under that same session, and the record is written under it too. The
 * service key is used for the file itself only, because the image bucket is
 * not writable by a person's session.
 *
 * Body: multipart/form-data with `organizationId`, `clientId` and `file`.
 */

import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/clients/logo")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const { bearerToken, clientForToken, requireMember } =
          await import("@/lib/context-packet.server");
        const { storeClientLogo, CLIENT_LOGO_MAX_BYTES } = await import("@/lib/client-logo.server");

        const token = bearerToken(request);
        if (!token) return json({ error: "Missing bearer token." }, 401);

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return json({ error: "That upload could not be read." }, 400);
        }

        const organizationId = String(form.get("organizationId") ?? "").trim();
        const clientId = String(form.get("clientId") ?? "").trim();
        const file = form.get("file");
        if (!organizationId || !clientId || !(file instanceof File)) {
          return json({ error: "organizationId, clientId and file are required." }, 400);
        }
        if (file.size > CLIENT_LOGO_MAX_BYTES) {
          return json({ error: "That image is larger than 2 MB." }, 400);
        }

        const caller = clientForToken(token);
        const identity = await requireMember(caller, token, organizationId);
        if (!identity) return json({ error: "You are not an active member here." }, 403);

        const result = await storeClientLogo({
          caller,
          organizationId,
          clientId,
          userId: identity.userId,
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });

        if (!result.ok) return json({ error: result.because ?? "That image was not saved." }, 400);
        return json({ url: result.url });
      },
    },
  },
});
