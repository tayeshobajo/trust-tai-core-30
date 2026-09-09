/**
 * ZenMode → Scout lead import endpoint.
 *
 * The human-triggerable surface for the import. Lead DISCOVERY has exactly one
 * trigger — the "Scrape leads" checkbox in ZenMode.app, on Tai's machine — and
 * ZenMode exposes no campaign API, so nothing here can cause a scrape or send
 * anything to LinkedIn. This route only pulls leads ZenMode has ALREADY found
 * and lands them on the Scout board.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself. A caller must present a valid Trust Tai Supabase access token
 * and an active organization membership, both verified server-side, and every
 * write is made with the CALLER'S token so RLS still applies.
 *
 * Safe to re-run: the import is idempotent and additive only. A lead already on
 * the board (same LinkedIn route or ZenMode lead_id) is counted as a duplicate
 * and left untouched; a human-owned row is never overwritten by a transport
 * pull.
 */

import { createFileRoute } from "@tanstack/react-router";

import { zenModeStatus } from "@/lib/zenmode-provider.server";
import { runZenModeImportForCaller } from "@/lib/zenmode-scout-import.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

/** Both gates must be on for the import to do anything. Reported so the UI can
 * explain "not connected" without a failed POST. Never reveals the key. */
function importStatus() {
  const provider = zenModeStatus();
  return {
    provider,
    import_enabled: process.env["ZENMODE_SCOUT_IMPORT_ENABLED"] === "true",
  };
}

export const Route = createFileRoute("/api/public/zenmode/import")({
  server: {
    handlers: {
      // Configuration probe. Reveals whether ZenMode is wired and whether the
      // import gate is open, never a key and never any part of one.
      GET: async () => Response.json(importStatus()),

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to import ZenMode leads." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId =
          typeof body["organization_id"] === "string" ? body["organization_id"] : undefined;
        const campaignId =
          typeof body["campaign_id"] === "string" ? body["campaign_id"] : undefined;
        const status = typeof body["status"] === "string" ? body["status"] : undefined;
        // Deliberately NOT defaulted. An unset limit pages through every lead;
        // a default would silently cap the import and read as a small campaign.
        const limit =
          typeof body["limit"] === "number" && Number.isFinite(body["limit"])
            ? Math.max(1, Math.floor(body["limit"]))
            : undefined;

        try {
          const outcome = await runZenModeImportForCaller({
            token,
            organizationId,
            campaignId,
            status,
            limit,
          });

          if (!outcome.ok) {
            return outcome.refusal === "unauthenticated"
              ? Response.json(
                  { error: "Your session is not valid. Sign in again." },
                  { status: 401 },
                )
              : Response.json(
                  { error: "Your account is not a member of a Trust Tai workspace." },
                  { status: 403 },
                );
          }

          return Response.json({
            organization_id: outcome.organizationId,
            ...outcome.result,
          });
        } catch (error) {
          // Fail closed and say so plainly. A partial import is visible in the
          // board; it is never reported as a success.
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "The ZenMode import stopped unexpectedly.",
            },
            { status: 502 },
          );
        }
      },
    },
  },
});
