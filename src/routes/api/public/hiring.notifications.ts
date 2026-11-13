import { createFileRoute } from "@tanstack/react-router";
import { hiringNotificationSchedule } from "@/lib/hiring-email-scheduler.server";

export const Route = createFileRoute("/api/public/hiring/notifications")({
  server: { handlers: { POST: ({ request }) => hiringNotificationSchedule(request) } },
});
