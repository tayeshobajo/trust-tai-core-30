/**
 * Governed LinkedIn action execution endpoint — SERVER ONLY.
 *
 * This is the single HTTP surface for the P2 execution plumbing. The browser
 * reaches it only with a valid Supabase session, the action must already be
 * `approved`, the caller must be the approver (Tai), and the
 * LINKI_EXECUTION_ENABLED kill switch must be ON. Any failure means nothing
 * was sent.
 *
 * Idempotency contract: POST /api/linki/execute with an action id whose row
 * is executing/executed/verified returns the EXISTING receipt — a double
 * click, a retried request, or a crashed client can never double-send.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

import { linkiActionErrorStatus, LinkiActionError } from "@/domain/linki-actions";
import { createLinkiActionService } from "@/data/supabase/linki-actions-service";
import { supabaseActivity } from "@/data/supabase/activities";
import { linkiSendAction } from "@/lib/linki-execution.server";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function clientFor(token: string): SupabaseClient {
  const key = trustTaiSupabaseKey();
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}`, apikey: key },
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/linki/execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return json({ error: "Sign in to execute LinkedIn actions." }, 401);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const actionId = typeof body["action_id"] === "string" ? body["action_id"].trim() : "";
        if (!actionId) {
          return json({ error: "action_id is required." }, 400);
        }

        // Session auth: a real, signed-in user — never a service key.
        const supabase = clientFor(token);
        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        const user = userData?.user;
        if (userError || !user) {
          return json(
            { error: "Your session has expired. Sign in again to execute LinkedIn actions." },
            401,
          );
        }

        // Active workspace membership, same gate as every governed route.
        const { data: memberships } = await supabase
          .from("organization_memberships")
          .select("organization_id, status")
          .eq("user_id", user.id);
        const active = (memberships ?? []).filter((m) => (m["status"] ?? "active") === "active");
        if (active.length === 0) {
          return json({ error: "Your account is not a member of this Trust Tai workspace." }, 403);
        }

        // Resolve the action's organization, then require the caller to be a
        // member of THAT organization (not just any).
        const { data: actionLookup, error: actionError } = await supabase
          .from("approved_linkedin_actions")
          .select("id, organization_id")
          .eq("id", actionId)
          .maybeSingle();
        if (actionError || !actionLookup) {
          return json({ error: "That LinkedIn action does not exist." }, 404);
        }
        const organizationId = String(actionLookup["organization_id"]);
        if (!active.some((m) => m["organization_id"] === organizationId)) {
          return json({ error: "That LinkedIn action belongs to another workspace." }, 403);
        }

        const service = createLinkiActionService(supabaseActivity, linkiSendAction);

        try {
          const { action, alreadyDone } = await service.execute(actionId, {
            organizationId,
            userId: user.id,
          });
          return json({
            status: action.status,
            already_done: alreadyDone,
            receipt: action.executionReceipt,
            failure_reason: action.failureReason,
          });
        } catch (error) {
          if (error instanceof LinkiActionError) {
            return json({ error: error.message, code: error.code }, linkiActionErrorStatus(error.code));
          }
          return json({ error: "Execution failed. Nothing was sent." }, 502);
        }
      },
    },
  },
});
