/**
 * The hourly reconciliation trigger.
 *
 * A scheduler calls this. It settles open intelligence cases that a canonical
 * room event has already answered, writes at most one outcome per case, and
 * executes nothing anywhere else in the suite. Unknown stays open.
 *
 * Fail closed: without a configured shared secret the endpoint refuses. The
 * secret lives in a service role only config row in the database, so the
 * hourly job can be activated from Supabase without any deployment change.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/intelligence/reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { authorizeReconcileRequest } = await import(
          "@/lib/intelligence-reconcile-auth.server"
        );

        const allowed = await authorizeReconcileRequest(
          supabaseAdmin as never,
          request.headers.get("x-reconcile-secret"),
        );
        if (!allowed.ok) {
          return Response.json({ ok: false, error: allowed.error }, { status: allowed.status });
        }

        const { organizationsWithCases, reconcileOrganization } = await import(
          "@/lib/intelligence-reconcile.server"
        );

        const organizations = await organizationsWithCases(supabaseAdmin as never);
        const runs = [];
        for (const organizationId of organizations) {
          try {
            runs.push(await reconcileOrganization(supabaseAdmin as never, organizationId));
          } catch (error) {
            runs.push({
              organizationId,
              casesConsidered: 0,
              outcomesWritten: 0,
              unknownLeftOpen: 0,
              error: error instanceof Error ? error.message : "run failed",
            });
          }
        }

        return Response.json({ ok: true, at: new Date().toISOString(), runs });
      },
    },
  },
});
