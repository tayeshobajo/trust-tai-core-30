/**
 * POST /api/public/projects/ask
 *
 * Project Chat. One question about one project, answered from that project's
 * own context packet plus anything the person pasted for this turn. It reads
 * and it answers. It never writes project truth: assignments, work items,
 * blockers, decisions and files all stay behind the Projects services and
 * their human gates.
 *
 * Security: this path bypasses site auth, so the handler authenticates the
 * caller's own Supabase token and verifies active membership of the named
 * organization before reading anything. The packet is read under that session,
 * so row level security decides what the answer may see.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/projects/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return json({ error: "Sign in to ask this project." }, 401);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "").trim();
        const projectId = String(body["project_id"] ?? "").trim();
        const question = String(body["question"] ?? "").trim();
        const pasted = String(body["pasted"] ?? "").trim();
        if (!organizationId || !projectId || !question) {
          return json({ error: "A project and a question are required." }, 400);
        }

        const { clientForToken, requireMember, readContextPacket, PacketNotFoundError } =
          await import("@/lib/context-packet.server");

        const supabase = clientForToken(token);
        const caller = await requireMember(supabase, token, organizationId);
        if (!caller) return json({ error: "Not a member of that workspace." }, 403);

        let packet: unknown;
        let projectLabel = "This project";
        try {
          const read = await readContextPacket(supabase, {
            organizationId,
            projectId,
            agentId: null,
          });
          packet = read.packet;
          const named = (read.packet as { project?: { name?: string } } | null)?.project?.name;
          if (named) projectLabel = named;
        } catch (error) {
          if (error instanceof PacketNotFoundError) return json({ error: error.message }, 404);
          console.error("project ask packet read failed", error);
          return json({ error: "This project could not be read right now." }, 502);
        }

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const { askProject, readProjectMessage } = await import(
          "@/lib/project-intelligence.server"
        );
        // "prepare" reads the message and names a bounded project-owned action.
        // It still writes nothing: a person approves, and the write happens
        // through the Projects service.
        const prepare = String(body["mode"] ?? "ask").trim() === "prepare";
        const members = Array.isArray(body["members"])
          ? (body["members"] as unknown[]).map((entry) => String(entry ?? "").trim()).filter(Boolean)
          : [];

        try {
          const result = prepare
            ? await readProjectMessage({
                token,
                organizationId,
                projectLabel,
                message: question,
                packet,
                members,
                gateway,
              })
            : await askProject({
                token,
                organizationId,
                projectLabel,
                question,
                packet,
                ...(pasted ? { pasted } : {}),
                gateway,
              });

          return withLovableAiGatewayRunIdHeader(
            new Response(JSON.stringify(result), {
              headers: {
                ...getLovableAiGatewayResponseHeaders(undefined),
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
            }),
            gateway,
          );
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 502);
        }
      },
    },
  },
});
