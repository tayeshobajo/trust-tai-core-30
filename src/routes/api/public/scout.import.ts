/**
 * Scout Smart Import endpoint.
 *
 * Streams what it is doing (reading the source, extracting companies) while a
 * read is still going, then returns extracted candidates. It writes nothing:
 * the caller reviews the result and a person saves it explicitly.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself, a valid Trust Tai access token plus an active organization
 * membership, both verified server-side by the runtime boundary.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
} from "@/lib/ai-gateway.server";
import {
  extractCompanies,
  fetchSourceText,
  SourceUnreadableError,
} from "@/lib/scout-import.server";
import type { SmartImportStage } from "@/domain/scout-smart-import";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/scout/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to import a source." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId =
          typeof body["organization_id"] === "string" ? body["organization_id"] : "";
        const link = typeof body["link"] === "string" ? body["link"].trim() : "";
        const pasted = typeof body["text"] === "string" ? body["text"] : "";

        if (!organizationId) {
          return Response.json({ error: "No workspace was named." }, { status: 400 });
        }
        if (!link && !pasted.trim()) {
          return Response.json({ error: "There is nothing to read." }, { status: 400 });
        }

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            const send = (stage: SmartImportStage) =>
              controller.enqueue(encoder.encode(`${JSON.stringify(stage)}\n`));

            try {
              send({ stage: "reading", message: "Reading source" });
              const source = link ? await fetchSourceText(link) : { text: pasted, label: "text" };

              send({ stage: "extracting", message: "Finding companies" });
              const outcome = await extractCompanies({
                token,
                organizationId,
                text: source.text,
                gateway,
              });

              send({ stage: "checking", message: "Checking against Scout" });

              // A deterministic read is never presented as an AI read, and an
              // empty one after a provider failure is a failure, not a result.
              if (!outcome.providerAnswered && outcome.companies.length === 0) {
                send({
                  stage: "error",
                  message:
                    "Scout could not reach its intelligence provider, and reading the source line by line found nothing. Nothing was staged.",
                });
                return;
              }

              send({
                stage: "done",
                message: `${outcome.companies.length} ${
                  outcome.companies.length === 1 ? "company" : "companies"
                } read from the source`,
                companies: outcome.companies,
                deterministic: outcome.deterministic,
                providerAnswered: outcome.providerAnswered,
              });
            } catch (error) {
              const message =
                error instanceof SourceUnreadableError
                  ? error.message
                  : (error as Error).message === "forbidden"
                    ? "You do not have access to this workspace."
                    : "Scout could not read that source. Nothing was staged.";
              send({ stage: "error", message });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: getLovableAiGatewayResponseHeaders(undefined, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
          }),
        });
      },
    },
  },
});
