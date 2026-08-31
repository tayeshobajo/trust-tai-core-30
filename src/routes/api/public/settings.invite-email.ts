/**
 * Send an invitation email for an invitation that already exists.
 *
 * This endpoint changes nothing about who can reach what. It reads an existing
 * `organization_invitations` row as the caller, using the caller's own bearer
 * token, and only delivers a courtesy email. The caller must be an active
 * owner or admin of that organization; anyone else is refused.
 *
 * The route lives under `/api/public/*` because published sites gate that
 * prefix themselves, so authorization is verified here, in the handler.
 */

import { signInUrlFor } from "@/lib/auth-origin";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { sendInviteEmail } from "@/lib/settings-invite-email.server";
import { ROLE_LABEL, normalizeRole } from "@/domain/access";

const Body = z.object({
  organizationId: z.string().min(1).max(64),
  invitationId: z.string().min(1).max(64),
});

const PROJECT_REF = "okydosoacqdnursmmenf";

function supabaseUrl(): string {
  const configured = process.env["SUPABASE_URL"];
  if (configured && configured.includes(PROJECT_REF)) return configured.replace(/\/$/, "");
  return `https://${PROJECT_REF}.supabase.co`;
}

function publishableKey(): string {
  const configured = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (configured && configured.startsWith("sb_")) return configured;
  return "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL";
}

function refuse(status: number, because: string) {
  return Response.json({ delivered: false, because }, { status });
}

async function restGet<T>(path: string, token: string): Promise<T | null> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

export const Route = createFileRoute("/api/public/settings/invite-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") ?? "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        if (!token) return refuse(401, "Sign in before sending an invitation email.");

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return refuse(400, "That request was not understood.");
        const { organizationId, invitationId } = parsed.data;

        /* 1. Who is asking? Verified against Supabase Auth, never trusted from the body. */
        const userResponse = await fetch(`${supabaseUrl()}/auth/v1/user`, {
          headers: { apikey: publishableKey(), Authorization: `Bearer ${token}` },
        });
        if (!userResponse.ok) return refuse(401, "That session is no longer valid.");
        const user = (await userResponse.json().catch(() => null)) as
          | { id?: string; email?: string }
          | null;
        if (!user?.id) return refuse(401, "That session is no longer valid.");

        /* 2. Are they an active owner or admin of this organization? */
        const memberships = await restGet<{ role: string; status: string }[]>(
          `organization_memberships?organization_id=eq.${organizationId}&user_id=eq.${user.id}&select=role,status`,
          token,
        );
        const membership = memberships?.[0];
        const role = normalizeRole(membership?.role ?? null);
        const active = (membership?.status ?? "") === "active";
        if (!membership || !active || (role !== "owner" && role !== "admin")) {
          return refuse(403, "Only an active owner or admin can send invitation emails.");
        }

        /* 3. The invitation itself, read as the caller so RLS still applies. */
        const invitations = await restGet<
          { email: string; role: string; status: string; expires_at: string | null }[]
        >(
          `organization_invitations?id=eq.${invitationId}&organization_id=eq.${organizationId}&select=email,role,status,expires_at`,
          token,
        );
        const invitation = invitations?.[0];
        if (!invitation) return refuse(404, "That invitation no longer exists.");
        if (invitation.status !== "pending") {
          return refuse(409, "That invitation is not pending, so nothing was sent.");
        }

        const organizations = await restGet<{ name: string }[]>(
          `organizations?id=eq.${organizationId}&select=name`,
          token,
        );
        const profiles = await restGet<{ preferred_name: string | null; full_name: string | null }[]>(
          `profiles?id=eq.${user.id}&select=full_name,preferred_name`,
          token,
        );
        const invitedByName =
          profiles?.[0]?.full_name ??
          profiles?.[0]?.preferred_name ??
          user.email ??
          "A workspace admin";

        const origin = new URL(request.url).origin;
        const result = await sendInviteEmail({
          to: invitation.email,
          organizationName: organizations?.[0]?.name ?? "your Trust Tai workspace",
          roleLabel: ROLE_LABEL[normalizeRole(invitation.role)],
          invitedByName,
          signInUrl: signInUrlFor(invitation.email, origin),
          expiresAt: invitation.expires_at,
        });

        return Response.json(result, { status: result.delivered ? 200 : 502 });
      },
    },
  },
});
