import { createFileRoute } from "@tanstack/react-router";
import { studioReceiptApplication } from "@/lib/studio-research-app.server";
export const Route = createFileRoute(
  "/api/studio/research/coordinator/$requestId/$operation",
)({ server: { handlers: { POST: ({ request }) => studioReceiptApplication(request) } } });
