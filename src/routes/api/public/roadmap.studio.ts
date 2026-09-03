/**
 * Studio composition endpoint.
 *
 * A raw HTTP route because the browser reads the run as a stream: building the
 * packet, writing the document and validating it against approved evidence
 * each take real time, and the room should see which step it is on.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself. A valid Trust Tai access token and an active organization
 * membership are both verified server-side before any model call is made.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";
import { runStudioComposition } from "@/lib/roadmap-studio.server";
import type { RoadmapMilestone, RoadmapResearch, RoadmapStrategy } from "@/domain/roadmap-intel";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/roadmap/studio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to compose with Studio." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const subjectLabel = String(body["subject_label"] ?? "").trim();
        const kind = body["kind"] === "full" ? "full" : "preview";
        if (!organizationId || !subjectLabel) {
          return Response.json(
            { error: "A workspace and a company are both required." },
            { status: 400 },
          );
        }

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const stage of runStudioComposition({
                token,
                organizationId,
                kind,
                subjectLabel,
                strategy: (body["strategy"] ?? null) as RoadmapStrategy | null,
                milestones: Array.isArray(body["milestones"])
                  ? (body["milestones"] as RoadmapMilestone[])
                  : [],
                research: (body["research"] ?? null) as RoadmapResearch | null,
                gateway,
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
