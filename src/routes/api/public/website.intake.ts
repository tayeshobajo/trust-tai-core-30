/**
 * POST /api/public/website/intake
 *
 * The single server-to-server door from TrustTai.com into Trust Tai OS.
 * Signed with a shared secret; the organization is server configuration, so a
 * payload can never place a submission in another workspace.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  IntakeBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  receiveIntake,
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

export const Route = createFileRoute("/api/public/website/intake")({
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
          console.error(`[website] intake rejected: ${auth.reason}`);
          return json(
            { accepted: false, error: auth.reason === "not_configured" ? "not_configured" : "unauthorized" },
            auth.reason === "not_configured" ? 503 : 401,
          );
        }

        const organizationId = websiteOrganizationId();
        if (!organizationId) {
          console.error("[website] intake rejected: WEBSITE_INTAKE_ORGANIZATION_ID is not set");
          return json({ accepted: false, error: "not_configured" }, 503);
        }

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          return json({ accepted: false, error: "invalid_json" }, 400);
        }

        const parsed = IntakeBody.safeParse(parsedBody);
        if (!parsed.success) {
          return json(
            { accepted: false, error: "invalid_payload", issues: parsed.error.issues.slice(0, 10) },
            400,
          );
        }

        // Identity is ours, not the caller's. A mismatched claim is an attack.
        if (parsed.data.organization_id && parsed.data.organization_id !== organizationId) {
          console.error("[website] intake rejected: organization mismatch");
          return json({ accepted: false, error: "organization_mismatch" }, 403);
        }

        try {
          const result = await receiveIntake(parsed.data, organizationId);
          return json(result, result.duplicate ? 200 : 201);
        } catch (error) {
          console.error("[website] intake failed:", (error as Error).message);
          return json({ accepted: false, error: "ingest_failed" }, 500);
        }
      },
    },
  },
});
