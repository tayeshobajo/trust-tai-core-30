import { createFileRoute } from "@tanstack/react-router";
import { readTrackerBaseline } from "@/lib/roadmap-tracker.server";

export const Route = createFileRoute("/api/public/roadmap/tracker-preview")({
  server: { handlers: { GET: ({ request }) => readTrackerBaseline(request) } },
});
