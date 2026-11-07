import { createFileRoute } from "@tanstack/react-router";
import { studioReceiptApplication } from "@/lib/studio-research-app.server";
import { studioPreviewOriginDiagnostic } from "@/lib/studio-research-preview-origin.server";
export const Route = createFileRoute(
  "/api/studio/research/coordinator/$requestId/$operation",
)({ server: { handlers: {
  POST: ({ request }) => studioReceiptApplication(request),
  // Temporary inert GET probe; no signed operations or request-body processing.
  GET: ({ request }) => Response.json(studioPreviewOriginDiagnostic(request), {
    headers: { "Cache-Control": "no-store" },
  }),
} } });
