import { createFileRoute } from "@tanstack/react-router";
import { readRoadmapCorrespondence } from "@/lib/roadmap-correspondence-read.server";
export const Route = createFileRoute("/api/public/roadmap/correspondence")({
  server: { handlers: { GET: ({ request }) => readRoadmapCorrespondence(request) } },
});
