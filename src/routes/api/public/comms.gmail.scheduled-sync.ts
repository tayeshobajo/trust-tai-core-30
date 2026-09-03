/**
 * Scheduled Gmail sync (raw HTTP).
 *
 * The proactive half of "never lose an important relationship": a conservative
 * pass over every connected mailbox so the reply clock stays honest without
 * anyone pressing "Read now". Cadence lives in the database cron (every 6
 * hours, see docs/comms-integrations-schema.sql); this route is what it calls.
 *
 * Auth is a shared cron secret, not a member session, because no person is
 * present. Fail-closed in both directions: no configured secret means no
 * endpoint, a wrong key means 401, and a mailbox that fails keeps its last
 * successful state and reports "Needs attention" through the connections page.
 * Read-only against Google, no send scope exists anywhere in this system.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

import { syncAllConnectedMailboxes } from "@/lib/comms-gmail.server";

function authorized(request: Request): boolean {
  const secret = process.env["COMMS_SYNC_CRON_SECRET"];
  if (!secret) return false;
  const presented = request.headers.get("X-Comms-Sync-Key") ?? "";
  if (!presented) return false;
  // Hash both sides so timing never leaks length.
  const expected = createHash("sha256").update(secret).digest();
  const given = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expected, given);
}

export const Route = createFileRoute("/api/public/comms/gmail/scheduled-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env["COMMS_SYNC_CRON_SECRET"]) {
          return Response.json(
            { error: "Scheduled sync is not configured on this server." },
            { status: 503 },
          );
        }
        if (!authorized(request)) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }

        let backfillDays: number | undefined;
        try {
          const body = (await request.json()) as Record<string, unknown>;
          if (typeof body["backfillDays"] === "number") backfillDays = body["backfillDays"];
        } catch {
          backfillDays = undefined;
        }

        try {
          const report = await syncAllConnectedMailboxes(
            backfillDays !== undefined ? { backfillDays } : undefined,
          );
          return Response.json(report);
        } catch (error) {
          const message = error instanceof Error ? error.message : "That sweep failed.";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
