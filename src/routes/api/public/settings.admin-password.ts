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

/**
 * Take someone out of the workspace.
 *
 *   revoke          they lose access; the sign-in account, their profile and
 *                   every record they ever touched stay exactly as they are.
 *   delete_account  the sign-in account is deleted too, so the address can be
 *                   provisioned again from scratch. Their identity is written
 *                   into the append-only activity history first, and no work
 *                   record (contacts, prospects, messages, decisions) is
 *                   deleted — only the credential.
 */
const RemoveBody = z.object({
  action: z.literal("remove_member"),
  organizationId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  mode: z.enum(["revoke", "delete_account"]).default("revoke"),
});

const Body = z.discriminatedUnion("action", [
  CreateBody,
  ResetBody,
  DirectoryBody,
  IdentityBody,
  RemoveBody,
]);

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

/**
 * The exact profile columns this project reads. `profiles` is owned outside
 * this repository, so a column we merely *hope* exists must never be able to
 * take a whole identity write down with it: one unknown column used to make
 * PostgREST refuse the entire row, which is how a person could be created with
 * an email and no name at all.
 */
const PROFILE_COLUMNS = ["id", "email", "full_name", "preferred_name", "job_title", "avatar_url"];

/** Column named by a PostgREST schema-cache complaint, if that is the failure. */
function missingColumn(body: unknown): string | null {
  const parsed = body as { code?: string; message?: string } | null;
  const message = parsed?.message ?? "";
  if (parsed?.code !== "PGRST204" && !/column/i.test(message)) return null;
  const match = message.match(/'([^']+)' column/) ?? message.match(/column "([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * Write identity rows, dropping any optional column this deployment does not
 * have and retrying. A column in `required` is never dropped: if the database
 * refuses that, the caller must hear about it.
 */
async function serviceWriteTolerant(
  path: string,
  key: string,
  row: Record<string, unknown>,
  required: string[],
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const current = { ...row };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await serviceWrite(path, key, [current]);
    if (result.ok) return result;
    const missing = missingColumn(result.body);
    if (!missing || required.includes(missing) || !(missing in current)) return result;
    delete current[missing];
  }
  return serviceWrite(path, key, [current]);
}

/**
 * Read profile rows as the service role, narrowing the projection if the
 * deployment lacks one of the optional display columns.
 */
async function readProfiles(
  filter: string,
  key: string,
): Promise<Record<string, string | null>[]> {
  for (const columns of [PROFILE_COLUMNS, ["id", "email", "full_name"]]) {
    const response = await fetch(
      `${supabaseUrl()}/rest/v1/profiles?${filter}&select=${columns.join(",")}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    ).catch(() => null);
    if (response?.ok) {
      return ((await response.json().catch(() => null)) as Record<string, string | null>[]) ?? [];
    }
  }
  return [];
}

/** How a person is named, in the one order the whole product agrees on. */
function displayNameOf(
  profile: Record<string, string | null> | undefined,
  authName: string | null,
  email: string,
): string {
  const candidate = (
    profile?.["full_name"] ||
    profile?.["preferred_name"] ||
    authName ||
    ""
  ).trim();
  if (candidate) return candidate;
  return (email.split("@")[0] ?? "").trim();
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
          const rows = await readProfiles(`id=in.${encodeURIComponent(list)}`, secret);
          const byId = new Map(rows.map((row) => [String(row["id"]), row]));


          /* Supabase Auth is the authority for a person's sign-in identity:
             the address they actually sign in with, when the account was
             created, and when they last signed in. profiles only enriches
             how that person is displayed. No column mirrors this. */
          type AuthFacts = {
            email: string | null;
            lastSignInAt: string | null;
            createdAt: string | null;
            emailConfirmedAt: string | null;
            name: string | null;
          };
          const authById = new Map<string, AuthFacts>();
          const bounded = ids.slice(0, 200);
          for (let index = 0; index < bounded.length; index += 10) {
            const batch = bounded.slice(index, index + 10);
            const facts = await Promise.all(
              batch.map(async (id) => {
                const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${id}`, {
                  headers: { apikey: secret, Authorization: `Bearer ${secret}` },
                }).catch(() => null);
                if (!response?.ok) return [id, null] as const;
                const body = (await response.json().catch(() => null)) as {
                  email?: string | null;
                  last_sign_in_at?: string | null;
                  created_at?: string | null;
                  email_confirmed_at?: string | null;
                  user_metadata?: { full_name?: string | null } | null;
                } | null;
                return [
                  id,
                  {
                    email: body?.email ?? null,
                    lastSignInAt: body?.last_sign_in_at ?? null,
                    createdAt: body?.created_at ?? null,
                    emailConfirmedAt: body?.email_confirmed_at ?? null,
                    name: body?.user_metadata?.full_name ?? null,
                  } satisfies AuthFacts,
                ] as const;
              }),
            );
            for (const [id, fact] of facts) if (fact) authById.set(id, fact);
          }

          /* An invitation is onboarding workflow state, not identity. Once the
             invited address signs in as a real member, the invitation is
             satisfied — it must not keep counting as a live pending invite.
             History in `activities` is untouched: nothing is rewritten. */
          const memberEmails = new Set(
            ids
              .map((id) => (authById.get(id)?.email ?? byId.get(id)?.["email"] ?? "").toLowerCase())
              .filter(Boolean),
          );
          const pending = await restGet<{ id: string; email: string }[]>(
            `organization_invitations?organization_id=eq.${input.organizationId}&status=eq.pending&select=id,email`,
            token,
            key,
          );
          const satisfied = (pending ?? []).filter((row) =>
            memberEmails.has((row.email ?? "").toLowerCase()),
          );
          if (satisfied.length > 0) {
            const idList = `(${satisfied.map((row) => `"${row.id}"`).join(",")})`;
            await fetch(
              `${supabaseUrl()}/rest/v1/organization_invitations?id=in.${encodeURIComponent(idList)}&status=eq.pending`,
              {
                method: "PATCH",
                headers: {
                  apikey: secret,
                  Authorization: `Bearer ${secret}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  status: "accepted",
                  accepted_at: new Date().toISOString(),
                }),
              },
            ).catch(() => null);
          }

          return Response.json({
            ok: true,
            reconciledInvitations: satisfied.length,
            people: ids.map((id) => {
              const row = byId.get(id);
              const auth = authById.get(id);
              /* Auth first: it is the address that actually signs in. */
              const email = (auth?.email ?? row?.["email"] ?? "") || "";
              return {
                userId: id,
                email,
                name: displayNameOf(row, auth?.name ?? null, email),
                jobTitle: row?.["job_title"] ?? null,
                avatarUrl: row?.["avatar_url"] ?? null,
                lastSignInAt: auth?.lastSignInAt ?? null,
                createdAt: auth?.createdAt ?? null,
                emailConfirmedAt: auth?.emailConfirmedAt ?? null,
              };
            }),
          });
        }


        /* ---------------------------------------- take someone out, keep the work */
        if (input.action === "remove_member") {
          if (input.userId === caller.id) {
            return refused(400, "You cannot remove your own access from this workspace.");
          }
          const target = await restGet<{ role: string }[]>(
            `organization_memberships?organization_id=eq.${input.organizationId}&user_id=eq.${input.userId}&select=role`,
            token,
            key,
          );
          if (!target?.[0]) {
            return refused(403, "That person is not a member of this workspace.");
          }
          if (normalizeRole(target[0].role) === "owner" && normalizeRole(membership?.role ?? "") !== "owner") {
            return refused(403, "Only an owner can remove another owner.");
          }

          /* Snapshot who this was before anything is removed, so the history
             stays readable even after the credential is gone. The address is
             the immutable evidence; the human name is added when known. */
          const profileRow = (await readProfiles(`id=eq.${input.userId}`, secret))[0];
          const authLook = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${input.userId}`, {
            headers: { apikey: secret, Authorization: `Bearer ${secret}` },
          }).catch(() => null);
          const authRow = (await authLook?.json().catch(() => null)) as {
            email?: string | null;
            user_metadata?: { full_name?: string | null } | null;
          } | null;
          const address = (authRow?.email ?? profileRow?.["email"] ?? "").toLowerCase();
          const label =
            displayNameOf(profileRow, authRow?.user_metadata?.full_name ?? null, address) ||
            address ||
            "A workspace member";

          const removedAt = new Date().toISOString();

          await serviceWrite("activities", secret, [
            {
              organization_id: input.organizationId,
              actor_user_id: caller.id,
              event_type:
                input.mode === "delete_account" ? "user.account_deleted" : "user.access_revoked",
              summary:
                input.mode === "delete_account"
                  ? `${label} was removed from the workspace and their sign-in account was deleted. Their records were kept.`
                  : `${label} was removed from the workspace. Their sign-in account and records were kept.`,
              occurred_at: removedAt,
              payload: {
                lifecycle: input.mode === "delete_account" ? "account_deleted" : "access_revoked",
                label: address || label,
                removed_user_id: input.userId,
                name: label,
                email: address || null,
                job_title: profileRow?.["job_title"] ?? null,
                role: normalizeRole(target[0].role),
              },
            },
          ]);

          /* Access first, in every case. */
          for (const path of [
            `member_app_access?organization_id=eq.${input.organizationId}&user_id=eq.${input.userId}`,
            `organization_memberships?organization_id=eq.${input.organizationId}&user_id=eq.${input.userId}`,
          ]) {
            await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
              method: "DELETE",
              headers: { apikey: secret, Authorization: `Bearer ${secret}` },
            }).catch(() => null);
          }

          if (input.mode === "delete_account") {
            const deleted = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${input.userId}`, {
              method: "DELETE",
              headers: { apikey: secret, Authorization: `Bearer ${secret}` },
            }).catch(() => null);
            if (deleted && !deleted.ok && deleted.status !== 404) {
              return refused(
                502,
                "Their workspace access was removed, but the sign-in account could not be deleted.",
              );
            }
          }

          return Response.json({
            ok: true,
            action: "remove_member",
            mode: input.mode,
            userId: input.userId,
            email: address || null,
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
          /* The same canonical profiles row every other surface reads. */
          const written = await serviceWriteTolerant(
            "profiles?on_conflict=id",
            secret,
            {
              id: input.userId,
              full_name: fullName || null,
              job_title: jobTitle || null,
              updated_at: new Date().toISOString(),
            },
            ["id", "full_name"],
          );
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

        const fullName = (input.fullName ?? "").trim();

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
            ...(fullName ? { user_metadata: { full_name: fullName } } : {}),
          }),
        });
        const createdBody = (await created.json().catch(() => null)) as {
          id?: string;
          error_code?: string;
          msg?: string;
          message?: string;
        } | null;

        let userId = createdBody?.id ?? null;
        let adopted = false;

        if (!created.ok || !userId) {
          const existing =
            (createdBody?.error_code ?? "").toLowerCase() === "email_exists" ||
            /already/i.test(createdBody?.msg ?? createdBody?.message ?? "");

          /* Idempotency. A retry — a double click, a lost response, a second
             attempt after a timeout — must land on the same person, never on a
             second account. If that address already signs in AND is already a
             member of THIS workspace, this is that retry: finish the same
             provisioning against the same user id. If the address exists but
             belongs to nobody here, it is somebody else's account and an admin
             of this workspace may not take it over. */
          if (existing) {
            const known = (await readProfiles(`email=eq.${encodeURIComponent(email)}`, secret))[0];
            const candidate = known?.["id"] ? String(known["id"]) : null;
            if (candidate) {
              const alreadyMember = await restGet<{ user_id: string }[]>(
                `organization_memberships?organization_id=eq.${input.organizationId}&user_id=eq.${candidate}&select=user_id`,
                token,
                key,
              );
              if (alreadyMember?.[0]) {
                userId = candidate;
                adopted = true;
              }
            }
          }

          if (!userId) {
            return Response.json(
              {
                ok: false,
                because: humanAuthError({
                  status: created.status,
                  code: createdBody?.error_code ?? null,
                  message: createdBody?.msg ?? createdBody?.message ?? null,
                }),
                existing,
              },
              { status: created.status === 422 ? 409 : 502 },
            );
          }
        }

        const role = normalizeRole(input.role);
        const now = new Date().toISOString();

        /* Canonical identity: the same profile + membership rows every other
           person in this workspace has. No parallel local-user model, and the
           human name is persisted before this call can report success. */
        const profileWrite = await serviceWriteTolerant(
          "profiles?on_conflict=id",
          secret,
          {
            id: userId,
            email,
            ...(fullName ? { full_name: fullName } : {}),
            updated_at: now,
          },
          fullName ? ["id", "full_name"] : ["id"],
        );
        if (!profileWrite.ok) {
          return refused(
            502,
            "The sign-in account exists but their name could not be saved. Open them in People & access and save the name again.",
          );
        }


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
