import { createClient } from "@supabase/supabase-js";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "./trust-tai-backend.server";
import { trackerBaseline } from "@/data/roadmap-tracker/baseline.server";
import { resolveAppAccess } from "@/domain/app-access";

// This verified workbook belongs to this existing workspace only.
const SOURCE_ORGANIZATION = "ee683a64-e045-4226-a8ff-4ae6590d6789";
export async function readTrackerBaseline(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!token)
    return Response.json({ error: "Sign in to review the tracker." }, { status: 401, headers });
  if (organizationId !== SOURCE_ORGANIZATION)
    return Response.json(
      { error: "This source is not available in this workspace." },
      { status: 403, headers },
    );
  try {
    const client = createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      return Response.json({ error: "Sign in to review the tracker." }, { status: 401, headers });
    const membership = await client
      .from("organization_memberships")
      .select("status, role")
      .eq("organization_id", organizationId)
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (membership.error || membership.data?.["status"] !== "active")
      return Response.json(
        { error: "Active workspace membership is required." },
        { status: 403, headers },
      );
    const [organization, member, role] = await Promise.all([
      client
        .from("organization_app_settings")
        .select("enabled")
        .eq("organization_id", organizationId)
        .eq("app_key", "roadmap")
        .maybeSingle(),
      client
        .from("member_app_access")
        .select("access_level")
        .eq("organization_id", organizationId)
        .eq("user_id", data.user.id)
        .eq("app_key", "roadmap")
        .maybeSingle(),
      client
        .from("organization_role_app_access")
        .select("access_level")
        .eq("organization_id", organizationId)
        .eq("role", membership.data["role"])
        .eq("app_key", "roadmap")
        .maybeSingle(),
    ]);
    if (organization.error || member.error || role.error)
      return Response.json(
        { error: "Roadmap access could not be verified." },
        { status: 503, headers },
      );
    const access = resolveAppAccess("roadmap", {
      role: membership.data["role"],
      membershipActive: true,
      organizationEnabled: organization.data?.["enabled"] !== false,
      override: member.data?.["access_level"] ?? role.data?.["access_level"],
    });
    if (!access.visible)
      return Response.json(
        { error: "Roadmap access is required to review this source." },
        { status: 403, headers },
      );
    return Response.json(trackerBaseline, { headers });
  } catch {
    return Response.json(
      { error: "Tracker access could not be verified. Try again after checking your session." },
      { status: 503, headers },
    );
  }
}
