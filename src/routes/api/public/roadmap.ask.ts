/**
 * Ask Roadmap endpoint.
 *
 * Grounded question answering over one roadmap's stored evidence. No web
 * search: if the stored evidence does not answer the question, the answer says
 * so rather than filling the gap.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself against a Trust Tai access token and organization membership.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";
import { askRoadmap } from "@/lib/roadmap-research.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/roadmap/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to ask Roadmap." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const question = String(body["question"] ?? "").trim();
        const subjectLabel = String(body["subject_label"] ?? "").trim();
        if (!organizationId || !question) {
          return Response.json({ error: "A question is required." }, { status: 400 });
        }

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));

        try {
          const result = await askRoadmap({
            token,
            organizationId,
            question,
            subjectLabel,
            context: body["context"] ?? {},
            // Opt in, per question. Roadmap does not silently search the web.
            research: body["research"] === true,

            gateway,
          });
          return withLovableAiGatewayRunIdHeader(
            Response.json(result, { headers: getLovableAiGatewayResponseHeaders(undefined) }),
            gateway,
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 502 },
          );
        }
      },
    },
  },
});
