/**
 * Studio · Audience, server side. Every check happens BEFORE the website's
 * global list is fetched:
 *   1. a live session,
 *   2. a literal `active` membership of the requested workspace,
 *   3. the requested workspace is the one this website audience is bound to,
 *   4. the caller is an owner or admin there.
 * The access code stays here. Neither it nor any subscriber is ever logged.
 */

import { createClient } from "@supabase/supabase-js";

import {
  failureForUpstreamStatus,
  pageAudience,
  parseAudienceFeed,
  AudienceShapeError,
  type AudienceFailure,
  type AudienceFeed,
  type AudienceFilter,
  type AudiencePage,
} from "@/domain/studio-audience";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

export const AUDIENCE_FEED_URL = "https://trusttai.com/api/public/newsletter/subscribers";
const AUDIENCE_ROLES = new Set(["owner", "admin"]);

export type AudienceResult =
  | ({ ok: true; feed: Omit<AudienceFeed, "subscribers">; returned: number; fetchedAt: string } & AudiencePage)
  | { ok: false; failure: AudienceFailure };

export interface AudienceDeps {
  env: (name: string) => string | undefined;
  /** Resolves the caller from a token. Returns null when not signed in. */
  identify: (token: string) => Promise<{ userId: string } | null>;
  /** The caller's own membership row for the workspace (read as them). */
  membership: (
    token: string,
    organizationId: string,
    userId: string,
  ) => Promise<{ status: string; role: string } | null>;
  fetch: typeof fetch;
  now: () => Date;
}

/** The workspace the trusttai.com audience belongs to. Unset = nobody. */
export function boundAudienceOrganization(env: AudienceDeps["env"]): string | null {
  return env("STUDIO_AUDIENCE_ORGANIZATION_ID") || env("WEBSITE_INTAKE_ORGANIZATION_ID") || null;
}

export function defaultAudienceDeps(): AudienceDeps {
  const clientFor = (token: string) =>
    createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  return {
    env: (n) => process.env[n],
    identify: async (token) => {
      const { data, error } = await clientFor(token).auth.getUser();
      return error || !data.user ? null : { userId: data.user.id };
    },
    membership: async (token, organizationId, userId) => {
      const { data, error } = await clientFor(token)
        .from("organization_memberships")
        .select("role, status")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      return { status: String(row["status"] ?? ""), role: String(row["role"] ?? "") };
    },
    fetch: (...a) => fetch(...a),
    now: () => new Date(),
  };
}

export async function readStudioAudience(
  input: { token: string; organizationId: string; filter: AudienceFilter; page: number },
  deps: AudienceDeps = defaultAudienceDeps(),
): Promise<AudienceResult> {
  if (!input.token) return { ok: false, failure: "not_signed_in" };
  const caller = await deps.identify(input.token);
  if (!caller) return { ok: false, failure: "not_signed_in" };

  const membership = await deps.membership(input.token, input.organizationId, caller.userId);
  if (!membership || membership.status !== "active") return { ok: false, failure: "not_member" };

  const bound = boundAudienceOrganization(deps.env);
  if (!bound) return { ok: false, failure: "not_configured" };
  if (bound !== input.organizationId) return { ok: false, failure: "wrong_workspace" };

  if (!AUDIENCE_ROLES.has(membership.role.trim().toLowerCase())) {
    return { ok: false, failure: "not_authorized" };
  }

  const secret = deps.env("STUDIO_AUDIENCE_TOKEN");
  if (!secret) return { ok: false, failure: "not_configured" };

  const url = new URL(AUDIENCE_FEED_URL);
  if (input.filter !== "all") url.searchParams.set("status", input.filter);

  let response: Response;
  try {
    response = await deps.fetch(url.toString(), {
      method: "GET",
      headers: { "x-studio-token": secret, accept: "application/json" },
    });
  } catch {
    console.warn("[studio-audience] website feed unreachable");
    return { ok: false, failure: "source_error" };
  }
  if (!response.ok) {
    console.warn(`[studio-audience] website feed answered ${response.status}`);
    return { ok: false, failure: failureForUpstreamStatus(response.status) };
  }

  let feed: AudienceFeed;
  try {
    feed = parseAudienceFeed(await response.json());
  } catch (error) {
    if (!(error instanceof AudienceShapeError)) console.warn("[studio-audience] unreadable body");
    return { ok: false, failure: "source_shape" };
  }

  const page = pageAudience(feed.subscribers, input.filter, input.page);
  const { subscribers, ...rest } = feed;
  return {
    ok: true,
    feed: rest,
    returned: subscribers.length,
    fetchedAt: deps.now().toISOString(),
    ...page,
  };
}
