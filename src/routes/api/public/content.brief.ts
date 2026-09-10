/**
 * The Studio brief endpoint.
 *
 * A raw HTTP route because Studio calls it from the browser with a bearer
 * token; this path bypasses site auth, so the handler authenticates every
 * request itself and the runtime boundary verifies membership again.
 *
 * It composes a draft brief and returns it. It writes nothing, publishes
 * nothing, and never answers with an invented brief: a provider that cannot
 * answer produces a stated reason.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";
import { composeBrief } from "@/lib/content-brief.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

const list = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

export const Route = createFileRoute("/api/public/content/brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to build a brief." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const opportunityId = String(body["opportunity_id"] ?? "").trim();
        const phrase = String(body["phrase"] ?? "").trim();
        if (!organizationId || !opportunityId || !phrase) {
          return Response.json(
            { error: "A workspace, an opportunity and a phrase are all required." },
            { status: 400 },
          );
        }

        const knownPages = Array.isArray(body["known_pages"])
          ? (body["known_pages"] as { path?: string; title?: string }[])
              .map((entry) => ({
                path: String(entry?.path ?? "").trim(),
                title: String(entry?.title ?? "").trim(),
              }))
              .filter((entry) => entry.path)
              .slice(0, 60)
          : [];

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));

        try {
          const result = await composeBrief({
            token,
            organizationId,
            opportunityId,
            phrase,
            observed: list(body["observed"], 12),
            audienceLanguage: list(body["audience_language"], 12),
            studioRead: String(body["studio_read"] ?? "").slice(0, 1200),
            suggestedMove: String(body["suggested_move"] ?? "").slice(0, 200),
            knownPages,
            decided: list(body["decided"], 12),
            gateway,
          });

          if (!result.ok) {
            return withLovableAiGatewayRunIdHeader(
              Response.json(
                { error: result.because },
                { status: 503, headers: getLovableAiGatewayResponseHeaders() },
              ),
              gateway,
            );
          }

          return withLovableAiGatewayRunIdHeader(
            Response.json(
              { brief: result.brief, provider: result.provider, model: result.model },
              { headers: getLovableAiGatewayResponseHeaders() },
            ),
            gateway,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "forbidden") {
            return Response.json({ error: "This workspace is not yours to read." }, { status: 403 });
          }
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
