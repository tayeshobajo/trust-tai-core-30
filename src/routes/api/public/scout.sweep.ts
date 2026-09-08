/**
 * Scheduled watchlist sweep (raw HTTP).
 *
 * The quiet background half of Sentinel: once a day the database cron calls
 * this route, and Scout re-reads a bounded number of watched companies whose
 * evidence is missing or stale. Nobody is present, so the caller is a shared
 * cron secret rather than a member session.
 *
 * Fail closed in both directions: no configured secret means no endpoint, a
 * wrong key means 401, and one unreadable company keeps its previous evidence
 * and is reported as unreadable. Nothing is discovered, added, scored as
 * urgent, or sent.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

import { runScheduledSweep, sweepConfigured } from "@/lib/scout-sweep.server";

function authorized(request: Request): boolean {
  const secret = process.env["SCOUT_SWEEP_CRON_SECRET"];
  if (!secret) return false;
  const presented = request.headers.get("X-Scout-Sweep-Key") ?? "";
  if (!presented) return false;
  const expected = createHash("sha256").update(secret).digest();
  const given = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expected, given);
}

export const Route = createFileRoute("/api/public/scout/sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env["SCOUT_SWEEP_CRON_SECRET"]) {
          return Response.json(
            { error: "The scheduled watchlist sweep is not configured on this server." },
            { status: 503 },
          );
        }
        if (!authorized(request)) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        if (!sweepConfigured()) {
          return Response.json(
            { error: "The scheduled sweep has no server credentials configured." },
            { status: 503 },
          );
        }

        try {
          return Response.json(await runScheduledSweep());
        } catch (error) {
          const message = error instanceof Error ? error.message : "That sweep failed.";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
