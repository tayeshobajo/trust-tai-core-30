/**
 * Provisioning identity, proven end to end against a stand-in Supabase.
 *
 * The failure this guards against is specific and was real: a person could be
 * created with a working sign-in account and no name at all, because one
 * optional profile column this deployment does not have made PostgREST refuse
 * the entire identity row. The name the operator typed was simply lost, and
 * People & access then showed "Unnamed person".
 *
 * These tests exercise the governed route itself, authority check, Auth admin
 * call, profile write, membership write, directory read, so the guarantee is
 * about behaviour and not about one helper in isolation.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Route } from "@/routes/api/public/settings.admin-password";

const ORG = "org-1";
const CALLER = "caller-1";
const NEW_USER = "user-new-1";

type Handler = (context: { request: Request }) => Promise<Response> | Response;

function post(body: unknown): Promise<Response> {
  const handlers = (Route as unknown as { options: { server: { handlers: { POST: Handler } } } })
    .options.server.handlers;
  return Promise.resolve(
    handlers.POST({
      request: new Request("https://cmd.trusttai.com/api/public/settings/admin-password", {
        method: "POST",
        headers: { authorization: "Bearer caller-token", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    }),
  ) as Promise<Response>;
}

/**
 * A Supabase that behaves like production in the one way that matters: the
 * `profiles` table has no `display_name` column and rejects any write naming
 * it, exactly as PostgREST does.
 */
function fakeSupabase() {
  const profiles = new Map<string, Record<string, unknown>>();
  const memberships = new Map<string, Record<string, unknown>>();
  const authUsers = new Map<string, Record<string, unknown>>([
    [CALLER, { id: CALLER, email: "owner@trusttai.com" }],
  ]);
  const created: string[] = [];
  const passwordsSet: string[] = [];

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : String(input));
    const path = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    /* Who is calling. */
    if (path === "/auth/v1/user") return json(authUsers.get(CALLER));

    /* Create a sign-in account. */
    if (path === "/auth/v1/admin/users" && method === "POST") {
      const email = String(body.email ?? "").toLowerCase();
      const existing = [...authUsers.values()].find(
        (user) => String(user["email"] ?? "").toLowerCase() === email,
      );
      if (existing) {
        return json(
          { error_code: "email_exists", msg: "A user with this email already exists" },
          422,
        );
      }
      const id = created.length === 0 ? NEW_USER : `${NEW_USER}-${created.length}`;
      created.push(id);
      authUsers.set(id, { id, email, user_metadata: body.user_metadata ?? {} });
      return json({ id, email });
    }

    if (path.startsWith("/auth/v1/admin/users/")) {
      const id = path.split("/").pop()!;
      if (method === "PUT") {
        passwordsSet.push(id);
        return json({ id });
      }
      const user = authUsers.get(id);
      return user ? json(user) : json({ msg: "not found" }, 404);
    }

    if (path === "/rest/v1/organization_memberships") {
      if (method === "POST") {
        for (const row of body as Record<string, unknown>[]) {
          memberships.set(String(row["user_id"]), row);
        }
        return json(body);
      }
      const userFilter = url.searchParams.get("user_id")?.replace("eq.", "");
      if (userFilter === CALLER) return json([{ role: "owner", status: "active" }]);
      if (userFilter) {
        const row = memberships.get(userFilter);
        return json(row ? [row] : []);
      }
      /* The whole workspace, as the directory reads it. */
      return json([...memberships.values()]);
    }

    if (path === "/rest/v1/profiles") {
      if (method === "POST") {
        for (const row of body as Record<string, unknown>[]) {
          /* Production truth: this column does not exist. */
          if ("display_name" in row) {
            return json(
              {
                code: "PGRST204",
                message:
                  "Could not find the 'display_name' column of 'profiles' in the schema cache",
              },
              400,
            );
          }
          const id = String(row["id"]);
          profiles.set(id, { ...(profiles.get(id) ?? {}), ...row });
        }
        return json(body);
      }
      const select = (url.searchParams.get("select") ?? "").split(",");
      if (select.includes("display_name")) {
        return json({ code: "42703", message: "column profiles.display_name does not exist" }, 400);
      }
      const idFilter = url.searchParams.get("id") ?? "";
      const emailFilter = url.searchParams.get("email")?.replace("eq.", "");
      let rows = [...profiles.values()];
      if (idFilter.startsWith("eq.")) {
        rows = rows.filter((row) => row["id"] === idFilter.slice(3));
      } else if (idFilter.startsWith("in.")) {
        const wanted = decodeURIComponent(idFilter.slice(3));
        rows = rows.filter((row) => wanted.includes(String(row["id"])));
      }
      if (emailFilter) {
        rows = rows.filter(
          (row) =>
            String(row["email"] ?? "").toLowerCase() ===
            decodeURIComponent(emailFilter).toLowerCase(),
        );
      }
      return json(rows);
    }

    if (path === "/rest/v1/organization_invitations") return json([]);
    if (path === "/rest/v1/member_app_access") return json([]);
    if (path === "/rest/v1/activities") return json([]);

    return json([]);
  };

  return { handler, profiles, memberships, authUsers, created, passwordsSet };
}

let backend: ReturnType<typeof fakeSupabase>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env["TRUST_TAI_SUPABASE_URL"] = "https://okydosoacqdnursmmenf.supabase.co";
  process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] = "sb_secret_test";
  backend = fakeSupabase();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    backend.handler(input, init)) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const createRequest = {
  action: "create_user",
  organizationId: ORG,
  email: "am.ayobamii@gmail.com",
  password: "Trust-Tai-2026!",
  confirmation: "Trust-Tai-2026!",
  role: "team_member",
  access: {},
  fullName: "Ayobami Muyiwa",
};

describe("provisioning a person with a temporary password", () => {
  it("persists the human name before it reports success", async () => {
    const response = await post(createRequest);
    const body = (await response.json()) as { ok: boolean; userId: string; name: string | null };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("Ayobami Muyiwa");

    const profile = backend.profiles.get(body.userId);
    expect(profile?.["full_name"]).toBe("Ayobami Muyiwa");
    expect(profile?.["email"]).toBe("am.ayobamii@gmail.com");
    expect(backend.memberships.get(body.userId)).toBeTruthy();
  });

  it("shows that exact name and email immediately, before any first sign-in", async () => {
    await post(createRequest);
    const response = await post({ action: "directory", organizationId: ORG });
    const body = (await response.json()) as {
      people: { userId: string; name: string; email: string; lastSignInAt: string | null }[];
    };

    const person = body.people.find((entry) => entry.userId === NEW_USER);
    expect(person?.name).toBe("Ayobami Muyiwa");
    expect(person?.email).toBe("am.ayobamii@gmail.com");
    expect(person?.lastSignInAt).toBeNull();
    expect(body.people.map((entry) => entry.name)).not.toContain("Unnamed person");
  });

  it("survives a reload: a second directory read names the same person the same way", async () => {
    await post(createRequest);
    const first = (await (await post({ action: "directory", organizationId: ORG })).json()) as {
      people: { userId: string; name: string }[];
    };
    const second = (await (await post({ action: "directory", organizationId: ORG })).json()) as {
      people: { userId: string; name: string }[];
    };
    expect(second.people).toEqual(first.people);
    expect(second.people.find((entry) => entry.userId === NEW_USER)?.name).toBe("Ayobami Muyiwa");
  });

  it("is idempotent: a retry finishes the same person instead of creating a second account", async () => {
    const first = (await (await post(createRequest)).json()) as { userId: string };
    const retry = await post(createRequest);
    const body = (await retry.json()) as { ok: boolean; userId: string; adopted: boolean };

    expect(retry.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.adopted).toBe(true);
    expect(body.userId).toBe(first.userId);
    expect(backend.created).toHaveLength(1);
    expect(backend.memberships.size).toBe(1);
    /* The password the operator just handed over is the live one. */
    expect(backend.passwordsSet).toContain(first.userId);
  });

  it("refuses to take over an address that signs in but belongs to no member here", async () => {
    backend.authUsers.set("stranger", { id: "stranger", email: "someone@else.com" });
    const response = await post({ ...createRequest, email: "someone@else.com" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { ok: boolean; existing: boolean };
    expect(body.ok).toBe(false);
    expect(body.existing).toBe(true);
  });

  it("keeps the name when an admin edits identity later", async () => {
    const created = (await (await post(createRequest)).json()) as { userId: string };
    const response = await post({
      action: "set_identity",
      organizationId: ORG,
      userId: created.userId,
      fullName: "Ayobami M. Adeyemi",
      jobTitle: "Founder",
    });
    expect(response.status).toBe(200);
    expect(backend.profiles.get(created.userId)?.["full_name"]).toBe("Ayobami M. Adeyemi");
  });
});
