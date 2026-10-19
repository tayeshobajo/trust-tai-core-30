import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAppAccess } from "@/domain/app-access";

/** Same app switches, member override, role default and role ceiling as WorkspaceGate. */
export async function meetingProcessingDenial(
  client: SupabaseClient,
  org: string,
): Promise<Response | null> {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user)
    return Response.json({ error: "Sign in to prepare meetings." }, { status: 401 });
  const membership = await client
    .from("organization_memberships")
    .select("status,role")
    .eq("organization_id", org)
    .eq("user_id", auth.data.user.id)
    .maybeSingle();
  if (membership.error || membership.data?.status !== "active")
    return Response.json({ error: "Active workspace membership is required." }, { status: 403 });
  const [organization, member, role] = await Promise.all([
    client
      .from("organization_app_settings")
      .select("enabled")
      .eq("organization_id", org)
      .eq("app_key", "steward")
      .maybeSingle(),
    client
      .from("member_app_access")
      .select("access_level")
      .eq("organization_id", org)
      .eq("user_id", auth.data.user.id)
      .eq("app_key", "steward")
      .maybeSingle(),
    client
      .from("organization_role_app_access")
      .select("access_level")
      .eq("organization_id", org)
      .eq("role", membership.data.role)
      .eq("app_key", "steward")
      .maybeSingle(),
  ]);
  if (organization.error || member.error || role.error)
    return Response.json({ error: "Steward work access could not be verified." }, { status: 503 });
  const access = resolveAppAccess("steward", {
    role: membership.data.role,
    membershipActive: true,
    organizationEnabled: organization.data?.enabled !== false,
    override: member.data?.access_level ?? role.data?.access_level,
  });
  return access.visible && access.canWork
    ? null
    : Response.json(
        { error: "Steward work access is required to prepare and save meeting deliverables." },
        { status: 403 },
      );
}
