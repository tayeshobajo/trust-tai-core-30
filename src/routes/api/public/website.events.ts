/**
 * POST /api/public/website/events
 *
 * The small attention/funnel event vocabulary TrustTai.com sends so the
 * Website room can show real numbers. Same signature scheme as intake.
 * Events are deduplicated on `event_key`, so retries never inflate a funnel.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  EventsBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  receiveEvents,
  verifyIntakeSignature,
  websiteIntakeSecret,
  websiteOrganizationId,
} from "@/lib/website-intake.server";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/public/website/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();

        const auth = verifyIntakeSignature({
          secret: websiteIntakeSecret(),
          signature: request.headers.get(SIGNATURE_HEADER),
          timestamp: request.headers.get(TIMESTAMP_HEADER),
          rawBody: raw,
        });
        if (!auth.ok) {
          return json(
            { accepted: false, error: auth.reason === "not_configured" ? "not_configured" : "unauthorized" },
            auth.reason === "not_configured" ? 503 : 401,
          );
        }

        const organizationId = websiteOrganizationId();
        if (!organizationId) return json({ accepted: false, error: "not_configured" }, 503);

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          return json({ accepted: false, error: "invalid_json" }, 400);
        }

        const parsed = EventsBody.safeParse(parsedBody);
        if (!parsed.success) return json({ accepted: false, error: "invalid_payload" }, 400);
        if (parsed.data.organization_id && parsed.data.organization_id !== organizationId) {
          return json({ accepted: false, error: "organization_mismatch" }, 403);
        }

        try {
          const result = await receiveEvents(parsed.data, organizationId);
          return json(result, 202);
        } catch (error) {
          console.error("[website] events failed:", (error as Error).message);
          return json({ accepted: false, error: "ingest_failed" }, 500);
        }
      },
    },
  },
});
