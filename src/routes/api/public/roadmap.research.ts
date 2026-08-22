/**
 * Roadmap research endpoint.
 *
 * A raw HTTP route rather than a server function because the browser reads it
 * as a stream: a real research pass takes minutes, and the room should see what
 * is happening rather than a spinner.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself. A caller must present a valid Trust Tai access token and an
 * active organization membership, both verified server-side.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";
import { runRoadmapResearch } from "@/lib/roadmap-intelligence.server";
import { runtimeProviderStatus } from "@/lib/intelligence-runtime.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/roadmap/research")({
  server: {
    handlers: {
      /** Configuration probe. Which provider is selected, never any key. */
      GET: async () => Response.json(runtimeProviderStatus()),

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to research with Roadmap." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const subjectLabel = String(body["subject_label"] ?? "").trim();
        const objective = String(body["objective"] ?? "").trim();
        if (!organizationId || !subjectLabel) {
          return Response.json(
            { error: "A workspace and a company are both required." },
            { status: 400 },
          );
        }

        const website = typeof body["website"] === "string" ? body["website"] : undefined;
        const known = Array.isArray(body["known"]) ? body["known"].map(String) : undefined;
        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const stage of runRoadmapResearch({
                token,
                organizationId,
                subjectLabel,
                objective,
                gateway,
                ...(website ? { website } : {}),
                ...(known ? { known } : {}),
              })) {
                controller.enqueue(encoder.encode(`${JSON.stringify(stage)}\n`));
              }
            } catch (error) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    stage: "error",
                    message: error instanceof Error ? error.message : String(error),
                  })}\n`,
                ),
              );
            } finally {
              controller.close();
            }
          },
        });

        return withLovableAiGatewayRunIdHeader(
          new Response(stream, {
            headers: getLovableAiGatewayResponseHeaders(undefined, {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-store",
            }),
          }),
          gateway,
        );
      },
    },
  },
});
