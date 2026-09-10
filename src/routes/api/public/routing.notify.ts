/**
 * Tell a receiving room that Projects asked it for something.
 *
 * This forwards nothing but references and the human's own sentences to a
 * fixed, server-configured inbox for that room. There is no arbitrary
 * destination: the URL comes from the environment, never from the caller, and
 * no evidence, contact or client data travels with it.
 *
 * A missing inbox is a truthful answer, not an error: Ops is external and
 * Studio is not built yet.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  organizationId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
  projectName: z.string().min(1).max(200),
  targetApp: z.enum(["ops", "studio"]),
  requestedOutcome: z.string().min(1).max(500),
  because: z.string().min(1).max(1000),
  routeEventKey: z.string().min(1).max(300),
  requestedAt: z.string().min(1).max(40),
});

function answer(delivered: boolean, because: string) {
  return Response.json({ delivered, because });
}

export const Route = createFileRoute("/api/public/routing/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return answer(false, "That notification was not understood, so nothing was sent.");
        }
        const route = parsed.data;
        const endpoint =
          route.targetApp === "ops"
            ? process.env["OPS_ROUTING_INBOX_URL"]
            : process.env["STUDIO_ROUTING_INBOX_URL"];
        if (!endpoint) {
          return answer(
            false,
            `No ${route.targetApp === "ops" ? "Ops" : "Studio"} inbox is configured yet, so nobody was notified.`,
          );
        }

        try {
          const secret = process.env["ROUTING_INBOX_SECRET"];
          const delivery = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(secret ? { "x-trust-tai-signature": secret } : {}),
            },
            body: JSON.stringify({ type: "trust-tai-os:route_requested", route }),
          });
          if (!delivery.ok) {
            return answer(
              false,
              "That room's inbox refused the notification. The ask still stands.",
            );
          }
          return answer(true, "The receiving room was notified and can accept or reject it.");
        } catch {
          return answer(false, "That room could not be reached just now. The ask still stands.");
        }
      },
    },
  },
});
