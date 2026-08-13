/**
 * Scout discovery endpoint.
 *
 * A raw HTTP route rather than a server function because the browser reads it
 * as a stream: Scout reports what it is doing (reading ICP, searching,
 * verifying, evaluating) while a multi-minute research run is still going.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself. A caller must present a valid Trust Tai Supabase access token
 * and an active organization membership — both verified server-side.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  discoveryConfigured,
  discoveryModel,
  runDiscovery,
} from "@/lib/scout-discover.server";
import {
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  LOVABLE_AIG_RUN_ID_HEADER,
} from "@/lib/ai-gateway.server";


function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/scout/discover")({
  server: {
    handlers: {
      // Configuration probe. Reveals only whether intelligence is connected.
      GET: async () =>
        Response.json({
          configured: discoveryConfigured(),
          provider: "openai",
          model: discoveryConfigured() ? discoveryModel() : null,
        }),

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to use Scout discovery." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const query = typeof body["query"] === "string" ? body["query"] : "";
        const organizationId =
          typeof body["organization_id"] === "string" ? body["organization_id"] : undefined;
        const limit = typeof body["limit"] === "number" ? body["limit"] : undefined;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const stage of runDiscovery({
                token,
                query,
                ...(organizationId ? { organizationId } : {}),
                ...(limit ? { limit } : {}),
              })) {
                controller.enqueue(encoder.encode(`${JSON.stringify(stage)}\n`));
              }
            } catch (error) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    stage: "error",
                    message:
                      error instanceof Error
                        ? error.message
                        : "Scout stopped unexpectedly. Nothing was changed.",
                  })}\n`,
                ),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
