/**
 * Gmail connect (raw HTTP).
 *
 * Two jobs, one endpoint, because Google requires a single registered
 * redirect URI:
 *
 *  POST, an authenticated member asks for a consent URL, or hands back the
 *          code Google returned so the server can exchange it. The exchange
 *          runs under the caller's own token, so RLS still applies.
 *  GET, Google's callback. It carries no Trust Tai session, so it does not
 *          touch the database at all: it verifies the signed state and bounces
 *          the browser back into Comms, which completes the exchange while
 *          signed in.
 *
 * Only `gmail.readonly` is ever requested. No token is ever returned to the
 * browser.
 */

import { createFileRoute } from "@tanstack/react-router";

import { readState, signState } from "@/lib/comms-crypto.server";
import {
  authorizeUrl,
  disconnect,
  exchangeCode,
  gmailAvailable,
  gmailRedirectUri,
  readAccountEmail,
  saveConnection,
} from "@/lib/comms-gmail.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

const RETURN_PATH = "/modules/comms/integrations";

export const Route = createFileRoute("/api/public/comms/gmail/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const rawState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        // Not a callback: report whether the track can be offered at all.
        if (!code && !rawState && !error) {
          return Response.json({
            configured: gmailAvailable(),
            redirectUri: gmailRedirectUri(request),
          });
        }

        const state = rawState ? await readState(rawState) : null;
        const back = new URL(state?.returnTo || RETURN_PATH, url.origin);
        if (error) {
          back.searchParams.set("gmail_error", error);
          return Response.redirect(back.toString(), 302);
        }
        if (!state || !code) {
          back.searchParams.set("gmail_error", "That connection attempt expired. Try again.");
          return Response.redirect(back.toString(), 302);
        }

        back.searchParams.set("gmail_code", code);
        back.searchParams.set("gmail_state", rawState!);
        return Response.redirect(back.toString(), 302);
      },

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to manage connections." }, { status: 401 });
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

        const action = typeof body["action"] === "string" ? body["action"] : "";
        const organizationId =
          typeof body["organizationId"] === "string" ? body["organizationId"] : "";
        if (!organizationId) {
          return Response.json({ error: "A workspace is required." }, { status: 400 });
        }

        try {
          if (action === "authorize-url") {
            const state = await signState({
              organizationId,
              returnTo: RETURN_PATH,
              issuedAt: Date.now(),
            });
            return Response.json({
              url: authorizeUrl({ redirectUri: gmailRedirectUri(request), state }),
            });
          }

          if (action === "exchange") {
            const code = typeof body["code"] === "string" ? body["code"] : "";
            const rawState = typeof body["state"] === "string" ? body["state"] : "";
            const state = rawState ? await readState(rawState) : null;
            if (!code || !state) {
              return Response.json(
                { error: "That connection attempt expired. Start again." },
                { status: 400 },
              );
            }
            if (state.organizationId !== organizationId) {
              return Response.json({ error: "That workspace does not match." }, { status: 400 });
            }

            const tokens = await exchangeCode({
              code,
              redirectUri: gmailRedirectUri(request),
            });
            const accountEmail = await readAccountEmail(tokens.accessToken);
            await saveConnection({
              token,
              organizationId,
              accountEmail,
              refreshToken: tokens.refreshToken,
              accessToken: tokens.accessToken,
              expiresAt: tokens.expiresAt,
            });
            return Response.json({ connected: true, accountEmail });
          }

          if (action === "disconnect") {
            await disconnect({ token, organizationId });
            return Response.json({ connected: false });
          }

          return Response.json({ error: "Unknown action." }, { status: 400 });
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : "That connection could not be completed.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
