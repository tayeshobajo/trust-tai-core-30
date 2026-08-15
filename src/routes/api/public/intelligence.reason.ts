/**
 * Intelligence Engine reasoning endpoint.
 *
 * Takes a packet of observations the suite already made and returns readings
 * that connect them. It never reads the database itself and never writes: the
 * caller assembles the packet under RLS, and verification happens on the way
 * back in the client-safe engine module.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request itself against a Trust Tai access token and organization membership.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";
import { reasonOverPacket } from "@/lib/intelligence-reason.server";
import type { EvidencePacket } from "@/data/intelligence/engine/hypothesise";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/intelligence/reason")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "Sign in to read the business." }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const packet = body["packet"] as EvidencePacket | undefined;
        if (!organizationId || !packet || !Array.isArray(packet.observations)) {
          return Response.json(
            { error: "An organization and an evidence packet are required." },
            { status: 400 },
          );
        }

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));

        try {
          const result = await reasonOverPacket({
            token,
            organizationId,
            packet: { ...packet, organizationId },
            gateway,
          });
          return withLovableAiGatewayRunIdHeader(
            Response.json(result, { headers: getLovableAiGatewayResponseHeaders(undefined) }),
            gateway,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "forbidden") {
            return Response.json(
              { error: "You are not a member of this workspace." },
              { status: 403 },
            );
          }
          /* No provider, or the provider refused: the engine stays honest and
             the caller falls back to its deterministic read. */
          return Response.json({ error: message, hypotheses: [] }, { status: 502 });
        }
      },
    },
  },
});
