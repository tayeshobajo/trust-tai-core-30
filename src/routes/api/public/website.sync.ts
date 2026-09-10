/**
 * POST /api/public/website/sync
 *
 * One bounded endpoint for the Website provider syncs: page inventory, GA4 and
 * Search Console. It is protected by the same database held secret pattern as
 * Intelligence reconciliation, read through the shared Core service role
 * client, so a schedule can be activated from Supabase without a deployment.
 *
 * It never reports success it did not earn: an unreadable site or an absent
 * credential is returned as such, and no row is written.
 */

import { createFileRoute } from "@tanstack/react-router";

const JOBS = ["inventory", "ga4", "search_console"] as const;
type Job = (typeof JOBS)[number];

export const Route = createFileRoute("/api/public/website/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { trustTaiServiceRoleClient } = await import("@/lib/execution-bridge.server");
        const { authorizeWebsiteSync, recordSyncRun } =
          await import("@/lib/website-sync-auth.server");

        const core = trustTaiServiceRoleClient();
        const allowed = await authorizeWebsiteSync(
          core as never,
          request.headers.get("x-website-sync-secret"),
        );
        if (!allowed.ok) {
          return Response.json({ ok: false, error: allowed.error }, { status: allowed.status });
        }

        let body: { job?: string; days?: number; limit?: number; origin?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }

        const requested = (body.job ?? "inventory").toString() as Job;
        if (!JOBS.includes(requested)) {
          return Response.json({ ok: false, error: "Unknown job." }, { status: 400 });
        }

        const organizationId =
          allowed.config.organizationId ?? process.env["WEBSITE_ORGANIZATION_ID"] ?? null;
        if (!organizationId) {
          return Response.json(
            { ok: false, error: "No organization is configured for website sync." },
            { status: 503 },
          );
        }

        const origin =
          (typeof body.origin === "string" && body.origin.trim()) ||
          allowed.config.siteOrigin ||
          "https://trusttai.com";

        try {
          if (requested === "inventory") {
            const { syncPageInventory } = await import("@/lib/website-inventory.server");
            const summary = await syncPageInventory(core as never, {
              organizationId,
              origin,
              ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
            });
            const failedEverything = summary.discovered === 0;
            await recordSyncRun(core as never, {
              organizationId,
              provider: "page_inventory",
              configured: true,
              rowsWritten: summary.upserted,
              error: failedEverything ? "No public page could be discovered." : null,
              summary: summary as unknown as Record<string, unknown>,
            });
            return Response.json(
              { ok: !failedEverything, job: requested, summary },
              { status: failedEverything ? 502 : 200 },
            );
          }

          const { syncGa4, syncSearchConsole } = await import("@/lib/website-providers.server");
          const days = typeof body.days === "number" ? body.days : 7;
          const result =
            requested === "ga4"
              ? await syncGa4(core as never, organizationId, days)
              : await syncSearchConsole(core as never, organizationId, days);

          await recordSyncRun(core as never, {
            organizationId,
            provider: result.provider,
            configured: result.configured,
            rowsWritten: result.rowsWritten,
            error: null,
            summary: result as unknown as Record<string, unknown>,
          });

          return Response.json({ ok: true, job: requested, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "sync failed";
          await recordSyncRun(core as never, {
            organizationId,
            provider: requested === "inventory" ? "page_inventory" : requested,
            configured: true,
            rowsWritten: 0,
            error: message,
          });
          return Response.json({ ok: false, job: requested, error: message }, { status: 502 });
        }
      },
    },
  },
});
