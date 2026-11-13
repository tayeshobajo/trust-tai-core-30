import { createHash, timingSafeEqual } from "node:crypto";
import { runScheduledHiringNotifications } from "./hiring-email-runtime.server";

export async function hiringNotificationSchedule(request: Request) {
  const secret = process.env["HIRING_NOTIFICATION_CRON_SECRET"];
  const headers = { "Cache-Control": "no-store" };
  if (!secret) return Response.json({ state: "not_configured" }, { status: 503, headers });
  const presented = request.headers.get("X-Hiring-Notification-Key");
  if (
    !presented ||
    !timingSafeEqual(
      createHash("sha256").update(secret).digest(),
      createHash("sha256").update(presented).digest(),
    )
  )
    return Response.json({ state: "unauthorized" }, { status: 401, headers });
  try {
    return Response.json(await runScheduledHiringNotifications(), { headers });
  } catch {
    return Response.json({ state: "ledger_unavailable" }, { status: 503, headers });
  }
}
