import { createFileRoute } from "@tanstack/react-router";
import { readEditableTracker, saveTrackerEdit } from "@/lib/roadmap-tracker-edit.server";
export const Route = createFileRoute("/api/public/roadmap/tracker")({
  server: {
    handlers: {
      GET: ({ request }) => readEditableTracker(request),
      PATCH: ({ request }) => saveTrackerEdit(request),
    },
  },
});
