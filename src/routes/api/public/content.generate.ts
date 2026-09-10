/**
 * The Content Engine endpoint.
 *
 * A raw HTTP route because the room watches the run happen: planning the
 * cluster and writing each article take real time, and a person should see
 * which post is being written rather than a spinner.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself. A valid Trust Tai access token is required, and the run is
 * bounded to twelve posts so a typo cannot become an expensive afternoon.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";
import { runContentCommand } from "@/lib/content-engine.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/content/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to write with Studio." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const keyword = String(body["keyword"] ?? "").trim();
        const count = Math.min(Math.max(Number(body["count"] ?? 10) || 10, 1), 12);
        if (!organizationId || !keyword) {
          return Response.json(
            { error: "A workspace and a keyword are both required." },
            { status: 400 },
          );
        }

        const knownPaths = Array.isArray(body["known_paths"])
          ? (body["known_paths"] as { path?: string; title?: string }[])
              .map((entry) => ({
                path: String(entry?.path ?? "").trim(),
                title: String(entry?.title ?? "").trim(),
              }))
              .filter((entry) => entry.path)
          : [];

        const instructions = String(body["instructions"] ?? "").slice(0, 4000);
        const settings = Array.isArray(body["settings"])
          ? (body["settings"] as { label?: string; value?: string }[])
              .map((entry) => ({
                label: String(entry?.label ?? "").trim(),
                value: String(entry?.value ?? "").trim(),
              }))
              .filter((entry) => entry.label && entry.value)
              .slice(0, 12)
          : [];
        /* Bounded on the way in as well as on the way out: reference material
           is evidence, not an unlimited prompt budget. */
        const voiceReferences = Array.isArray(body["voice_references"])
          ? (body["voice_references"] as { label?: string; kind?: string; excerpt?: string }[])
              .map((entry) => ({
                label: String(entry?.label ?? "").trim(),
                kind: String(entry?.kind ?? "text").trim(),
                excerpt: String(entry?.excerpt ?? "").slice(0, 2400),
              }))
              .filter((entry) => entry.excerpt.trim())
              .slice(0, 6)
          : [];

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const stage of runContentCommand({
                token,
                organizationId,
                keyword,
                count,
                knownPaths,
                instructions,
                settings,
                voiceReferences,
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
