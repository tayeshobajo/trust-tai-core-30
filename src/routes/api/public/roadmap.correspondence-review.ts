import { createFileRoute } from "@tanstack/react-router";
import { reviewRoadmapCorrespondence } from "@/lib/roadmap-correspondence-review.server";
export const Route = createFileRoute("/api/public/roadmap/correspondence-review")({
  server: {
    handlers: {
      GET: ({ request }) => reviewRoadmapCorrespondence(request),
      POST: ({ request }) => reviewRoadmapCorrespondence(request),
    },
  },
});
