import { createClient } from "@supabase/supabase-js";
import { resolveAppAccess } from "@/domain/app-access";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "./trust-tai-backend.server";

export const researchHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export class StudioResearchAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** Caller-scoped client: no service key, new grant or RLS bypass. */
export async function authorizeStudioResearch(
  request: Request,
  organizationId: string,
  write = false,
) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new StudioResearchAccessError("Sign in to use the research workspace.", 401);
  const client = createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new StudioResearchAccessError("Sign in to use the research workspace.", 401);
  const membership = await client
    .from("organization_memberships")
    .select("status, role")
    .eq("organization_id", organizationId)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (membership.error || membership.data?.["status"] !== "active")
    throw new StudioResearchAccessError("Active workspace membership is required.", 403);
  const [organization, member, role] = await Promise.all([
    client
      .from("organization_app_settings")
      .select("enabled")
      .eq("organization_id", organizationId)
      .eq("app_key", "studio")
      .maybeSingle(),
    client
      .from("member_app_access")
      .select("access_level")
      .eq("organization_id", organizationId)
      .eq("user_id", data.user.id)
      .eq("app_key", "studio")
      .maybeSingle(),
    client
      .from("organization_role_app_access")
      .select("access_level")
      .eq("organization_id", organizationId)
      .eq("role", membership.data["role"])
      .eq("app_key", "studio")
      .maybeSingle(),
  ]);
  if (organization.error || member.error || role.error)
    throw new StudioResearchAccessError("Studio access could not be verified.", 503);
  const access = resolveAppAccess("studio", {
    role: membership.data["role"],
    membershipActive: true,
    organizationEnabled: organization.data?.["enabled"] !== false,
    override: member.data?.["access_level"] ?? role.data?.["access_level"],
  });
  if (!access.visible || (write && !access.canWork))
    throw new StudioResearchAccessError(
      write ? "Your Studio access does not allow edits." : "Studio access is required.",
      403,
    );
  return { client, user: data.user, access };
}
