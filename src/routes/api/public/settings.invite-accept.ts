/**
 * Consume an invitation that already exists.
 *
 * This is the only path that turns an invitation into a membership, and it is
 * deliberately narrow:
 *
 *   1. the caller's own bearer token is verified against Supabase Auth, so the
 *      email being measured is the one Supabase says the session holds
 *   2. the invitation is read either by the id the emailed link carried or, if
 *      it carried none, by the verified session address, and is then evaluated
 *      by the shared domain rule in src/domain/invite-acceptance.ts
 *   3. only an "accept" decision may write anything
 *
 * A session signed in as somebody else is refused before any membership is
 * read or written, so no other account is ever evaluated as the invitee.
 *
 * Idempotent by construction: the membership write is an upsert on
 * (organization_id, user_id), an existing active membership is left exactly as
 * it is, and the invitation is only patched while it is still pending. Running
 * this twice cannot create a second membership or consume a different invite.
 *
 * No schema change was needed: status, accepted_at and app_access already
 * exist on organization_invitations.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { evaluateInviteAcceptance, mayConsumeInvitation } from "@/domain/invite-acceptance";
import { normalizeRole } from "@/domain/access";

/* The id is optional on purpose. Without it the endpoint resolves the pending
   invitation belonging to the verified session address; see step 2. */
const Body = z.object({
  invitationId: z.string().min(1).max(64).optional(),
});

const PROJECT_REF = "okydosoacqdnursmmenf";

function supabaseUrl(): string {
  const configured = process.env["TRUST_TAI_SUPABASE_URL"] || process.env["SUPABASE_URL"];
  if (configured && configured.includes(PROJECT_REF)) return configured.replace(/\/$/, "");
  return `https://${PROJECT_REF}.supabase.co`;
}

function publishableKey(): string {
  const configured = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (configured && configured.startsWith("sb_")) return configured;
  return "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL";
}

function serviceKey(): string | null {
  return (
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    null
  );
}

function refused(status: number, outcome: string, because: string) {
  return Response.json({ ok: false, outcome, because }, { status });
}

async function serviceGet<T>(path: string, key: string): Promise<T | null> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

async function serviceWrite(path: string, key: string, rows: unknown[]): Promise<boolean> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  }).catch(() => null);
  return Boolean(response?.ok);
}

interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
  app_access: Record<string, string> | null;
}

export const Route = createFileRoute("/api/public/settings/invite-accept")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") ?? "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        if (!token) {
          return refused(401, "no_session", "Sign in as the invited address to accept.");
        }

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return refused(400, "unknown", "That request was not understood.");

        const secret = serviceKey();
        if (!secret) {
          return refused(
            503,
            "unknown",
            "Invitation acceptance is not configured on this deployment. Ask an admin to add you directly.",
          );
        }

        /* 1. Who is asking? Supabase Auth answers, never the request body. */
        const userResponse = await fetch(`${supabaseUrl()}/auth/v1/user`, {
          headers: { apikey: publishableKey(), Authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (!userResponse?.ok)
          return refused(401, "no_session", "That session is no longer valid.");
        const user = (await userResponse.json().catch(() => null)) as {
          id?: string;
          email?: string;
        } | null;
        if (!user?.id || !user.email) {
          return refused(401, "no_session", "That session is no longer valid.");
        }

        /* 2. The invitation itself. Read with the service key because an
              invitee is, by definition, not yet a member and so cannot read
              this row through RLS. Nothing about it is returned to a caller
              who is not its subject.

              Two ways in, one rule. When the emailed link carried an id we
              read that exact row. When it did not (an older email, a
              forwarded link, a stripped query string, or somebody simply
              opening the app), we resolve the pending invitation issued to
              the address Supabase Auth just verified for this session. The
              claim therefore follows WHO IS SIGNED IN, never what a URL
              claims, and both routes are decided by the same domain rule
              below. The by-address lookup is filtered on the verified email
              server side, so it can only ever surface this person's own
              invitation, in the organization that issued it. */
        const wanted = parsed.data.invitationId;
        const sessionEmail = user.email.trim().toLowerCase();
        const select = "id,organization_id,email,role,status,expires_at,app_access";
        const query = wanted
          ? `organization_invitations?id=eq.${encodeURIComponent(wanted)}&select=${select}`
          : `organization_invitations?email=ilike.${encodeURIComponent(sessionEmail)}&status=eq.pending&select=${select}&order=created_at.desc&limit=1`;
        const rows = await serviceGet<InvitationRow[]>(query, secret);
        const invitation = rows?.[0] ?? null;

        const decision = evaluateInviteAcceptance({
          invitation: invitation
            ? {
                email: invitation.email,
                status: invitation.status,
                expiresAt: invitation.expires_at,
              }
            : null,
          sessionEmail: user.email,
        });

        if (!mayConsumeInvitation(decision)) {
          const status =
            decision.outcome === "wrong_account" ? 403 : decision.outcome === "unknown" ? 404 : 409;
          /* Nobody asked for a specific invitation and none is waiting: say
             exactly that, rather than implying a link went stale. */
          const because =
            !wanted && decision.outcome === "unknown"
              ? `No invitation is waiting for ${sessionEmail}. Ask whoever invited you to send one.`
              : decision.because;
          return Response.json(
            {
              ok: false,
              outcome: decision.outcome,
              because,
              invitedEmail: decision.invitedEmail,
              signedInEmail: decision.signedInEmail,
            },
            { status },
          );
        }

        const invite = invitation as InvitationRow;
        const now = new Date().toISOString();
        const role = normalizeRole(invite.role);

        /* 3. Existing membership wins. Re-running this link must never change
              a role somebody already holds, or add a second row. */
        const existing = await serviceGet<{ role: string; status: string }[]>(
          `organization_memberships?organization_id=eq.${invite.organization_id}&user_id=eq.${user.id}&select=role,status`,
          secret,
        );
        const already = existing?.[0] ?? null;

        if (!already) {
          const wrote = await serviceWrite(
            "organization_memberships?on_conflict=organization_id,user_id",
            secret,
            [
              {
                organization_id: invite.organization_id,
                user_id: user.id,
                role,
                status: "active",
                updated_at: now,
              },
            ],
          );
          if (!wrote) {
            return refused(
              502,
              "unknown",
              "Your invitation is valid but your workspace place could not be saved. Try again, or ask whoever invited you.",
            );
          }

          /* The per-app permissions the admin chose when inviting. Applied
             once, on first acceptance only, so a later re-visit cannot widen
             or reset access somebody has since adjusted. */
          const overrides = Object.entries(invite.app_access ?? {});
          if (overrides.length > 0) {
            await serviceWrite(
              "member_app_access?on_conflict=organization_id,user_id,app_key",
              secret,
              [
                ...overrides.map(([appKey, level]) => ({
                  organization_id: invite.organization_id,
                  user_id: user.id,
                  app_key: appKey,
                  access_level: level,
                  updated_at: now,
                })),
              ],
            );
          }

          /* A profile row so the person is named like everybody else. */
          await serviceWrite("profiles?on_conflict=id", secret, [
            { id: user.id, email: user.email, updated_at: now },
          ]).catch(() => false);
        } else if (already.status !== "active") {
          await serviceWrite(
            "organization_memberships?on_conflict=organization_id,user_id",
            secret,
            [
              {
                organization_id: invite.organization_id,
                user_id: user.id,
                role: already.role || role,
                status: "active",
                updated_at: now,
              },
            ],
          );
        }

        /* 4. The invitation leaves pending, and only while it still is. */
        await fetch(
          `${supabaseUrl()}/rest/v1/organization_invitations?id=eq.${encodeURIComponent(invite.id)}&status=eq.pending`,
          {
            method: "PATCH",
            headers: {
              apikey: secret,
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ status: "accepted", accepted_at: now }),
          },
        ).catch(() => null);

        return Response.json({
          ok: true,
          outcome: "accepted",
          organizationId: invite.organization_id,
          role: already?.role || role,
          alreadyMember: Boolean(already),
          because: "You are in. Opening your workspace.",
        });
      },
    },
  },
});
