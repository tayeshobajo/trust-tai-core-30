import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { hiringDelivery } from "@/lib/hiring-delivery.server";
export const Route = createFileRoute("/api/public/hiring/delivery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
        if (!token)
          return Response.json(
            { error: "Sign in required" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        try {
          const p = z
            .object({ outboxId: z.string().uuid(), reconcile: z.boolean().default(false) })
            .parse(await request.json());
          return Response.json(await hiringDelivery(token, p.outboxId, p.reconcile), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return Response.json(
            { error: "Delivery unavailable or access denied. Reload receipts before retrying." },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
