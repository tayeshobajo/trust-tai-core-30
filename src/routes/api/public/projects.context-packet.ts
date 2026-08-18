/**
 * GET /api/public/projects/context-packet
 *
 * The one endpoint an outside agent runtime uses to understand a project
 * before it acts. It returns the generated Project Context Packet: the
 * promise, the confirmed truth, the approved assets, where the work is being
 * built, what is moving, what is unresolved, and, when an agent is named, the
 * boundaries that agent is working inside.
 *
 * Security: the caller sends their own Supabase access token. The packet is
 * read under that session, so row level security applies, and active
 * membership of the named organization is verified before anything is read.
 * A token for another organization returns 403, never a partial packet.
 *
 * Query: organizationId (required), projectId (required), agentId (optional).
 */

import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      // The packet is session dependent, so no shared cache may ever hold it.
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/projects/context-packet")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const {
          bearerToken,
          clientForToken,
          requireMember,
          readContextPacket,
          PacketNotFoundError,
        } = await import("@/lib/context-packet.server");

        const token = bearerToken(request);
        if (!token) return json({ error: "Missing bearer token." }, 401);

        const url = new URL(request.url);
        const organizationId = (url.searchParams.get("organizationId") ?? "").trim();
        const projectId = (url.searchParams.get("projectId") ?? "").trim();
        const agentId = (url.searchParams.get("agentId") ?? "").trim() || null;
        if (!organizationId || !projectId) {
          return json({ error: "organizationId and projectId are required." }, 400);
        }

        const supabase = clientForToken(token);
        const caller = await requireMember(supabase, token, organizationId);
        if (!caller) return json({ error: "Not a member of that workspace." }, 403);

        try {
          const { packet, health } = await readContextPacket(supabase, {
            organizationId,
            projectId,
            agentId,
          });
          return json({ packet, health, generatedAt: new Date().toISOString() });
        } catch (error) {
          if (error instanceof PacketNotFoundError) {
            return json({ error: error.message }, 404);
          }
          // Provider detail stays server side. The caller gets a plain reason.
          console.error("context-packet read failed", error);
          return json({ error: "Could not read the project right now." }, 502);
        }
      },
    },
  },
});
