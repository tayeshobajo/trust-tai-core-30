/**
 * Admin-managed passwords for Trust Tai OS People & access.
 *
 * Two governed actions, both server-only:
 *
 *   create_user     provision a workspace user directly, with a temporary
 *                   password, and give them the canonical profile +
 *                   organization_membership every other person has.
 *   reset_password  set a new password for someone who is already a member.
 *
 * Authority is verified here, from the caller's own bearer token, before the
 * service key is touched at all: the caller must be an active owner or admin of
 * the organization named in the request, and the target must belong to that
 * same organization. `user_metadata` is never consulted.
 *
 * The plaintext password is read from the request body, handed straight to
 * Supabase Auth, and never written to a table, a log line, an activity payload
 * or a response body.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { normalizeRole } from "@/domain/access";
import { humanAuthError, refusePasswordAction, validatePassword } from "@/domain/admin-password";

const CreateBody = z.object({
  action: z.literal("create_user"),
  organizationId: z.string().min(1).max(64),
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
  confirmation: z.string().min(1).max(256),
  role: z.string().min(1).max(40),
  access: z.record(z.string(), z.string()).default({}),
  fullName: z.string().max(200).optional(),
});

const ResetBody = z.object({
  action: z.literal("reset_password"),
  organizationId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  confirmation: z.string().min(1).max(256),
});

/** Who is in this workspace, by name and email. No credential is ever read. */
const DirectoryBody = z.object({
  action: z.literal("directory"),
  organizationId: z.string().min(1).max(64),
});

/** A human edit to how someone is named in this workspace. */
const IdentityBody = z.object({
  action: z.literal("set_identity"),
  organizationId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  fullName: z.string().max(200),
  jobTitle: z.string().max(200).optional(),
});

const Body = z.discriminatedUnion("action", [CreateBody, ResetBody, DirectoryBody, IdentityBody]);

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

function refused(status: number, because: string) {
  return Response.json({ ok: false, because }, { status });
}

async function restGet<T>(path: string, token: string, key: string): Promise<T | null> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

async function serviceWrite(
  path: string,
  key: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body: parsed };
}

export const Route = createFileRoute("/api/public/settings/admin-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") ?? "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        if (!token) return refused(401, "Sign in before managing workspace passwords.");

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return refused(400, "That request was not understood.");
        const input = parsed.data;

        if (input.action === "create_user" || input.action === "reset_password") {
          const password = validatePassword(input.password, input.confirmation);
          if (!password.ok) return refused(400, password.because);
        }

        const key = publishableKey();
        const secret = serviceKey();
        if (!secret) {
          return refused(
            503,
            "Workspace identity management is not configured on this deployment. The invitation email path still works.",
          );
        }

        /* 1. Who is asking? Verified against Supabase Auth. */
        const userResponse = await fetch(`${supabaseUrl()}/auth/v1/user`, {
          headers: { apikey: key, Authorization: `Bearer ${token}` },
        });
        if (!userResponse.ok) return refused(401, "That session is no longer valid.");
        const caller = (await userResponse.json().catch(() => null)) as { id?: string } | null;
        if (!caller?.id) return refused(401, "That session is no longer valid.");

        /* 2. Their authority, read as themselves so RLS still applies. */
        const memberships = await restGet<{ role: string; status: string }[]>(
          `organization_memberships?organization_id=eq.${input.organizationId}&user_id=eq.${caller.id}&select=role,status`,
          token,
          key,
        );
        const membership = memberships?.[0];
        const refusal = refusePasswordAction({
          actorRole: membership?.role ?? null,
          actorActive: (membership?.status ?? "") === "active",
          actorOrganizationId: membership ? input.organizationId : null,
          organizationId: input.organizationId,
        });
        if (refusal) return refused(403, refusal);

        /* ------------------------------------------ who is in this workspace */
        if (input.action === "directory") {
          const members = await restGet<{ user_id: string }[]>(
            `organization_memberships?organization_id=eq.${input.organizationId}&select=user_id`,
            token,
            key,
          );
          const ids = (members ?? []).map((row) => row.user_id).filter(Boolean);
          if (ids.length === 0) return Response.json({ ok: true, people: [] });

          const list = `(${ids.map((id) => `"${id}"`).join(",")})`;
          const profiles = await fetch(
            `${supabaseUrl()}/rest/v1/profiles?id=in.${encodeURIComponent(list)}&select=id,email,full_name,display_name,job_title,avatar_url`,
            { headers: { apikey: secret, Authorization: `Bearer ${secret}` } },
          );
          const rows = (await profiles.json().catch(() => null)) as
            | {
                id: string;
                email: string | null;
                full_name: string | null;
                display_name: string | null;
                job_title: string | null;
                avatar_url: string | null;
              }[]
            | null;

          /* Emails that never reached a profile row still identify the person,
             so Auth is the fallback rather than a blank name. */
          const byId = new Map((rows ?? []).map((row) => [row.id, row]));
          const missing = ids.filter((id) => !byId.get(id)?.email);
          for (const id of missing.slice(0, 50)) {
            const authUser = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${id}`, {
              headers: { apikey: secret, Authorization: `Bearer ${secret}` },
            });
            if (!authUser.ok) continue;
            const body = (await authUser.json().catch(() => null)) as {
              email?: string;
              user_metadata?: { full_name?: string };
            } | null;
            const current = byId.get(id);
            byId.set(id, {
              id,
              email: body?.email ?? current?.email ?? null,
              full_name: current?.full_name ?? null,
              display_name: current?.display_name ?? null,
              job_title: current?.job_title ?? null,
              avatar_url: current?.avatar_url ?? null,
            });
          }

          return Response.json({
            ok: true,
            people: ids.map((id) => {
              const row = byId.get(id);
              return {
                userId: id,
                email: row?.email ?? "",
                name: (row?.display_name || row?.full_name || "").trim(),
                jobTitle: row?.job_title ?? null,
                avatarUrl: row?.avatar_url ?? null,
              };
            }),
          });
        }

        /* ------------------------------------------------ name someone plainly */
        if (input.action === "set_identity") {
          const target = await restGet<{ organization_id: string }[]>(
            `organization_memberships?organization_id=eq.${input.organizationId}&user_id=eq.${input.userId}&select=organization_id`,
            token,
            key,
          );
          if (!target?.[0]) {
            return refused(403, "That person is not a member of this workspace.");
          }

          const fullName = input.fullName.trim();
          const jobTitle = (input.jobTitle ?? "").trim();
          const written = await serviceWrite("profiles?on_conflict=id", secret, [
            {
              id: input.userId,
              full_name: fullName || null,
              display_name: fullName || null,
              job_title: jobTitle || null,
              updated_at: new Date().toISOString(),
            },
          ]);
          if (!written.ok) return refused(502, "That name could not be saved.");
          return Response.json({ ok: true, userId: input.userId, action: "set_identity" });
        }



        /* ------------------------------------------------- reset an existing */
        if (input.action === "reset_password") {
          const target = await restGet<{ organization_id: string }[]>(
            `organization_memberships?organization_id=eq.${input.organizationId}&user_id=eq.${input.userId}&select=organization_id`,
            token,
            key,
          );
          if (!target?.[0]) {
            return refused(403, "That person is not a member of this workspace.");
          }

          const updated = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${input.userId}`, {
            method: "PUT",
            headers: {
              apikey: secret,
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ password: input.password }),
          });
          if (!updated.ok) {
            const failure = (await updated.json().catch(() => null)) as {
              error_code?: string;
              msg?: string;
              message?: string;
            } | null;
            return refused(
              updated.status === 404 ? 404 : 422,
              updated.status === 404
                ? "That sign-in account no longer exists."
                : humanAuthError({
                    status: updated.status,
                    code: failure?.error_code ?? null,
                    message: failure?.msg ?? failure?.message ?? null,
                  }),
            );
          }
          return Response.json({ ok: true, userId: input.userId, action: "reset_password" });
        }

        /* ------------------------------------------------- create a new user */
        const email = input.email.trim().toLowerCase();

        const created = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
          method: "POST",
          headers: {
            apikey: secret,
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            password: input.password,
            /* Deliberate: temporary-password onboarding must not send the person
               through an email confirmation they were never told to expect. */
            email_confirm: true,
          }),
        });
        const createdBody = (await created.json().catch(() => null)) as {
          id?: string;
          error_code?: string;
          msg?: string;
          message?: string;
        } | null;

        if (!created.ok || !createdBody?.id) {
          const because = humanAuthError({
            status: created.status,
            code: createdBody?.error_code ?? null,
            message: createdBody?.msg ?? createdBody?.message ?? null,
          });
          return Response.json(
            {
              ok: false,
              because,
              existing:
                (createdBody?.error_code ?? "").toLowerCase() === "email_exists" ||
                /already/i.test(createdBody?.msg ?? createdBody?.message ?? ""),
            },
            { status: created.status === 422 ? 409 : 502 },
          );
        }

        const userId = createdBody.id;
        const role = normalizeRole(input.role);
        const now = new Date().toISOString();

        /* Canonical identity: the same profile + membership rows every other
           person in this workspace has. No parallel local-user model. */
        await serviceWrite(
          "profiles?on_conflict=id",
          secret,
          [
            {
              id: userId,
              email,
              ...(input.fullName?.trim()
                ? { full_name: input.fullName.trim(), display_name: input.fullName.trim() }
                : {}),
              updated_at: now,
            },
          ],
        );

        const memberWrite = await serviceWrite(
          "organization_memberships?on_conflict=organization_id,user_id",
          secret,
          [
            {
              organization_id: input.organizationId,
              user_id: userId,
              role,
              status: "active",
              updated_at: now,
            },
          ],
        );
        if (!memberWrite.ok) {
          return refused(
            502,
            "The sign-in account was created but workspace membership could not be recorded. Add them from People & access.",
          );
        }

        const overrides = Object.entries(input.access ?? {});
        if (overrides.length > 0) {
          await serviceWrite(
            "member_app_access?on_conflict=organization_id,user_id,app_key",
            secret,
            overrides.map(([appKey, level]) => ({
              organization_id: input.organizationId,
              user_id: userId,
              app_key: appKey,
              access_level: level,
              updated_by: caller.id,
              updated_at: now,
            })),
          );
        }

        /* If this person was already invited by email, that invitation is now
           satisfied rather than left hanging. */
        await fetch(
          `${supabaseUrl()}/rest/v1/organization_invitations?organization_id=eq.${input.organizationId}&email=eq.${encodeURIComponent(email)}&status=eq.pending`,
          {
            method: "PATCH",
            headers: {
              apikey: secret,
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: "accepted", accepted_at: now }),
          },
        ).catch(() => null);

        return Response.json({ ok: true, userId, email, role, action: "create_user" });
      },
    },
  },
});
