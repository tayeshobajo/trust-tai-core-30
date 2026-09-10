/**
 * POST /api/public/clients/ask
 *
 * Client Chat. One question about one account, answered from that account's
 * bounded context packet plus anything the person pasted for this turn. It
 * reads and it answers. It never writes account truth: commercial state,
 * relationships, projects and files all stay behind their own services and
 * their human gates.
 *
 * The packet itself is composed on the page from reads already made under the
 * caller's own session, so row level security has already decided what it may
 * contain. This handler still authenticates the caller's token and verifies
 * active membership of the named organization before a provider is reached, so
 * an unauthenticated or non-member caller can never spend a model call.
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

export const Route = createFileRoute("/api/public/clients/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return json({ error: "Sign in to ask this account." }, 401);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "").trim();
        const question = String(body["question"] ?? "").trim();
        const pasted = String(body["pasted"] ?? "").trim();
        const clientLabel = String(body["client_label"] ?? "").trim() || "This client";
        const packet = body["packet"] ?? null;
        if (!organizationId || !question || !packet) {
          return json({ error: "An account and a question are required." }, 400);
        }

        const { clientForToken, requireMember } = await import("@/lib/context-packet.server");
        const supabase = clientForToken(token);
        const caller = await requireMember(supabase, token, organizationId);
        if (!caller) return json({ error: "Not a member of that workspace." }, 403);

        const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const { askClient, readClientMessage } = await import("@/lib/client-intelligence.server");

        // "prepare" reads the message and names a bounded account-owned change.
        // It still writes nothing: a person approves, and the write happens
        // through the commercial service.
        const prepare = String(body["mode"] ?? "ask").trim() === "prepare";

        try {
          const result = prepare
            ? await readClientMessage({
                token,
                organizationId,
                clientLabel,
                message: question,
                packet,
                gateway,
              })
            : await askClient({
                token,
                organizationId,
                clientLabel,
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
