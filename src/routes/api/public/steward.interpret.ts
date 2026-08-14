/**
 * Steward semantic interpretation endpoint.
 *
 * POST — read one conversation's candidate passages for meaning. Nothing is
 * written. Interpretation is not confirmation: only a person, in the room,
 * turns a signal into workspace truth.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request against a Trust Tai access token and an active organization
 * membership before any transcript or model call is touched. The model key
 * never leaves the server.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Commitment, NormalizedConversation } from "@/domain/steward";
import type { MemoryContext } from "@/domain/steward-semantic";
import { detectCandidates } from "@/data/steward/candidates";
import {
  interpretConversation,
  InterpretationUnavailableError,
} from "@/lib/steward-interpret.server";
import { createLovableAiGatewayRunIdFetch, getLovableAiGatewayRunId } from "@/lib/ai-gateway.server";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function clientFor(token: string): SupabaseClient {
  const key = trustTaiSupabaseKey();
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
  });
}

async function requireMembership(
  supabase: SupabaseClient,
  token: string,
  organizationId: string,
): Promise<boolean> {
  if (!organizationId) return false;
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return false;
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("organization_id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userData.user.id)
    .limit(1);
  if (error) return false;
  return (data ?? []).some((row) => (row["status"] ?? "active") === "active");
}

/** Canonical memory, read as the caller. Unavailable is reported, never faked. */
async function readMemory(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ memory: MemoryContext; commitments: Commitment[] }> {
  try {
    const { data, error } = await supabase
      .from("commitments")
      .select("id, statement, owner_name, owner_email, status, conversation_id, source_key")
      .eq("organization_id", organizationId)
      .in("status", ["open", "waiting"])
      .limit(200);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const commitments = rows.map((row) => ({
      id: String(row["id"] ?? ""),
      organizationId,
      conversationId: String(row["conversation_id"] ?? ""),
      ownerName: String(row["owner_name"] ?? ""),
      what: String(row["statement"] ?? ""),
      status: String(row["status"] ?? "open"),
      sourceKey: String(row["source_key"] ?? ""),
      evidence: [],
      createdAt: "",
      updatedAt: "",
    })) as Commitment[];

    const [peopleResult, projectsResult] = await Promise.all([
      supabase
        .from("steward_role_memory")
        .select("name, title, pod, responsibilities")
        .eq("organization_id", organizationId)
        .limit(100),
      supabase.from("projects").select("id, name").eq("organization_id", organizationId).limit(100),
    ]);

    const people = (peopleResult.data ?? [])
      .map((row) => {
        const title = [row["title"], row["pod"]].filter(Boolean).join(" · ");
        const responsibilities = Array.isArray(row["responsibilities"])
          ? (row["responsibilities"] as string[]).slice(0, 4).join(", ")
          : "";
        const detail = [title, responsibilities].filter(Boolean).join(" — ");
        return detail
          ? { name: String(row["name"] ?? ""), title: detail }
          : { name: String(row["name"] ?? "") };

      })
      .filter((person) => person.name.length > 0);

    const projects = (projectsResult.data ?? [])
      .map((row) => ({ id: String(row["id"] ?? ""), label: String(row["name"] ?? "") }))
      .filter((project) => project.id.length > 0 && project.label.length > 0);

    return {
      commitments,
      memory: {
        available: true,
        because:
          people.length > 0
            ? "Read from this workspace's open commitments and known people."
            : "Read from this workspace's open commitments.",
        openCommitments: commitments.map((commitment) => ({
          id: commitment.id,
          statement: commitment.what,
          ownerName: commitment.ownerName,
          status: commitment.status,
        })),
        people,
        projects,
      },
    };

  } catch (error) {
    return {
      commitments: [],
      memory: {
        available: false,
        because:
          error instanceof Error
            ? `Canonical memory could not be read (${error.message}), so Steward interpreted from the meeting alone.`
            : "Canonical memory could not be read, so Steward interpreted from the meeting alone.",
        openCommitments: [],
        people: [],
        projects: [],
      },
    };
  }
}

export const Route = createFileRoute("/api/public/steward/interpret")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return Response.json({ error: "Sign in to use Steward." }, { status: 401 });

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const supabase = clientFor(token);
        if (!(await requireMembership(supabase, token, organizationId))) {
          return Response.json(
            { error: "You are not a member of this workspace." },
            { status: 403 },
          );
        }

        const conversation = body["conversation"] as NormalizedConversation | undefined;
        if (!conversation || !Array.isArray(conversation.segments)) {
          return Response.json({ error: "No conversation was sent to interpret." }, { status: 400 });
        }

        const { memory, commitments } = await readMemory(supabase, organizationId);
        const candidates = detectCandidates(conversation);
        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayRunIdFetch(initialRunId);

        try {
          const run = await interpretConversation({
            conversation,
            memory,
            commitments,
            candidates,
            gateway,
            initialRunId,
          });
          return Response.json({ run });
        } catch (error) {
          if (error instanceof InterpretationUnavailableError) {
            return Response.json({ error: error.message }, { status: 503 });
          }
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
