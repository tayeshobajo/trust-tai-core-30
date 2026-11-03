import { createFileRoute } from "@tanstack/react-router";
import { readConversationSummary } from "@/lib/roadmap-correspondence-summary.server";
export const Route = createFileRoute("/api/public/roadmap/conversation-summary")({
  server: { handlers: { GET: ({ request }) => readConversationSummary(request) } },
});
