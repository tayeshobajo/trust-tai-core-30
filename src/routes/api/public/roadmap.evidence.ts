import { createFileRoute } from "@tanstack/react-router";
import { readRoadmapEvidence } from "@/lib/roadmap-evidence-read.server";
export const Route = createFileRoute("/api/public/roadmap/evidence")({
  server: { handlers: { GET: ({ request }) => readRoadmapEvidence(request) } },
});
